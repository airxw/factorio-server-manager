"""Universal Model Runner Interface.

Provides a common interface for different model backends (Claude, GPT, Gemini, etc.),
with generic skill loading mechanism and multi-backend support.
"""

import abc
import argparse
import json
import os
import select
import subprocess
import sys
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


class BackendType(Enum):
    """Supported model backends."""
    CLAUDE = "claude"
    GPT = "gpt"
    GEMINI = "gemini"
    OPENAI_COMPATIBLE = "openai_compatible"


@dataclass
class BackendConfig:
    """Configuration for a model backend."""
    type: BackendType
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    timeout: int = 300
    extra_kwargs: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.extra_kwargs is None:
            self.extra_kwargs = {}


class BaseModelRunner(abc.ABC):
    """Abstract base class for model runners."""
    
    def __init__(self, config: BackendConfig):
        self.config = config
    
    @abc.abstractmethod
    def run_text_query(self, prompt: str) -> str:
        """Run a text query and return the response as text."""
        pass
    
    @abc.abstractmethod
    def run_stream_query(self, prompt: str, skill_context: Optional[Dict] = None) -> Tuple[bool, Any]:
        """Run a streaming query for trigger detection.
        
        Returns (triggered, raw_result).
        """
        pass


class OpenAICompatibleBackend(BaseModelRunner):
    """OpenAI-compatible API backend (for non-Claude Code environments)."""
    
    def __init__(self, config: BackendConfig):
        super().__init__(config)
        if not HAS_REQUESTS:
            raise ImportError("requests library is required for OpenAI-compatible backend")
    
    def run_text_query(self, prompt: str) -> str:
        """Run a text query using OpenAI-compatible chat completions API."""
        if not self.config.api_key:
            raise ValueError("api_key is required for OpenAI-compatible backend")
        if not self.config.base_url:
            raise ValueError("base_url is required for OpenAI-compatible backend")
        
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": self.config.model or "gpt-4-turbo",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=self.config.timeout)
        response.raise_for_status()
        result = response.json()
        return result["choices"][0]["message"]["content"]
    
    def run_stream_query(self, prompt: str, skill_context: Optional[Dict] = None) -> Tuple[bool, Any]:
        """Proxy trigger evaluation using text classification (no real stream needed)."""
        skill_name = skill_context.get("skill_name", "") if skill_context else ""
        skill_description = skill_context.get("skill_description", "") if skill_context else ""
        
        if not skill_name or not skill_description:
            return False, prompt
        
        # Use proxy trigger eval: ask model to classify whether it would trigger the skill
        proxy_prompt = f"""You are deciding whether to use a skill based on the user's query and the skill's description.

Skill name: {skill_name}
Skill description: {skill_description}

User query: {prompt}

Should you use this skill? Respond with ONLY "YES" or "NO", nothing else."""
        
        try:
            response = self.run_text_query(proxy_prompt).strip().upper()
            triggered = "YES" in response or "Y" == response
            return triggered, response
        except Exception:
            return False, prompt


class ClaudeBackend(BaseModelRunner):
    """Claude-specific backend using claude -p."""
    
    def __init__(self, config: BackendConfig):
        super().__init__(config)
        self._project_root = None
    
    def _get_project_root(self) -> Path:
        """Find the project root by walking up from cwd looking for .claude/."""
        if self._project_root:
            return self._project_root
        current = Path.cwd()
        for parent in [current, *current.parents]:
            if (parent / ".claude").is_dir():
                self._project_root = parent
                return parent
        self._project_root = current
        return current
    
    def _prepare_skill_context(self, skill_name: str, skill_description: str) -> Tuple[Path, Path]:
        """Temporarily create a skill file in .claude/commands for detection."""
        unique_id = uuid.uuid4().hex[:8]
        clean_name = f"{skill_name}-skill-{unique_id}"
        project_root = self._get_project_root()
        project_commands_dir = project_root / ".claude" / "commands"
        command_file = project_commands_dir / f"{clean_name}.md"
        
        project_commands_dir.mkdir(parents=True, exist_ok=True)
        indented_desc = "\n  ".join(skill_description.split("\n"))
        command_content = (
            f"---\n"
            f"description: |\n"
            f"  {indented_desc}\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"This skill handles: {skill_description}\n"
        )
        command_file.write_text(command_content)
        
        return command_file, clean_name
    
    def run_text_query(self, prompt: str) -> str:
        cmd = ["claude", "-p", "--output-format", "text"]
        if self.config.model:
            cmd.extend(["--model", self.config.model])
        
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            env=env,
            timeout=self.config.timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"claude -p exited {result.returncode}\nstderr: {result.stderr}"
            )
        return result.stdout
    
    def run_stream_query(self, prompt: str, skill_context: Optional[Dict] = None) -> Tuple[bool, Any]:
        skill_name = skill_context.get("skill_name", "") if skill_context else ""
        skill_description = skill_context.get("skill_description", "") if skill_context else ""
        timeout = skill_context.get("timeout", 30) if skill_context else 30
        
        command_file = None
        clean_name = ""
        if skill_name and skill_description:
            command_file, clean_name = self._prepare_skill_context(skill_name, skill_description)
        
        try:
            cmd = [
                "claude",
                "-p", prompt,
                "--output-format", "stream-json",
                "--verbose",
                "--include-partial-messages",
            ]
            if self.config.model:
                cmd.extend(["--model", self.config.model])
            
            env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
            project_root = self._get_project_root()
            
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=project_root,
                env=env,
            )
            
            triggered = False
            start_time = time.time()
            buffer = ""
            pending_tool_name = None
            accumulated_json = ""
            
            try:
                while time.time() - start_time < timeout:
                    if process.poll() is not None:
                        remaining = process.stdout.read()
                        if remaining:
                            buffer += remaining.decode("utf-8", errors="replace")
                        break
                    
                    ready, _, _ = select.select([process.stdout], [], [], 1.0)
                    if not ready:
                        continue
                    
                    chunk = os.read(process.stdout.fileno(), 8192)
                    if not chunk:
                        break
                    buffer += chunk.decode("utf-8", errors="replace")
                    
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        
                        if event.get("type") == "stream_event":
                            se = event.get("event", {})
                            se_type = se.get("type", "")
                            
                            if se_type == "content_block_start":
                                cb = se.get("content_block", {})
                                if cb.get("type") == "tool_use":
                                    tool_name = cb.get("name", "")
                                    if tool_name in ("Skill", "Read"):
                                        pending_tool_name = tool_name
                                        accumulated_json = ""
                                    else:
                                        return False, buffer
                            
                            elif se_type == "content_block_delta" and pending_tool_name:
                                delta = se.get("delta", {})
                                if delta.get("type") == "input_json_delta":
                                    accumulated_json += delta.get("partial_json", "")
                                    if clean_name in accumulated_json:
                                        return True, buffer
                            
                            elif se_type in ("content_block_stop", "message_stop"):
                                if pending_tool_name:
                                    return clean_name in accumulated_json, buffer
                                if se_type == "message_stop":
                                    return False, buffer
                        
                        elif event.get("type") == "assistant":
                            message = event.get("message", {})
                            for content_item in message.get("content", []):
                                if content_item.get("type") != "tool_use":
                                    continue
                                tool_name = content_item.get("name", "")
                                tool_input = content_item.get("input", {})
                                if tool_name == "Skill" and clean_name in tool_input.get("skill", ""):
                                    triggered = True
                                elif tool_name == "Read" and clean_name in tool_input.get("file_path", ""):
                                    triggered = True
                                return triggered, buffer
                        
                        elif event.get("type") == "result":
                            return triggered, buffer
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            
            return triggered, buffer
        finally:
            if command_file and command_file.exists():
                command_file.unlink()


class ModelRunnerFactory:
    """Factory for creating model runners."""
    
    _registry: Dict[BackendType, Callable[[BackendConfig], BaseModelRunner]] = {
        BackendType.CLAUDE: ClaudeBackend,
        BackendType.OPENAI_COMPATIBLE: OpenAICompatibleBackend,
    }
    
    @classmethod
    def register_backend(cls, backend_type: BackendType, runner_class: Callable[[BackendConfig], BaseModelRunner]):
        """Register a new backend type."""
        cls._registry[backend_type] = runner_class
    
    @classmethod
    def create(cls, config: BackendConfig) -> BaseModelRunner:
        """Create a model runner for the given config."""
        if config.type not in cls._registry:
            raise ValueError(f"Unsupported backend type: {config.type}")
        return cls._registry[config.type](config)


def load_backend_config(config_path: Optional[Path] = None, 
                        backend_type: Optional[str] = None, 
                        model: Optional[str] = None) -> BackendConfig:
    """Load backend configuration from file or CLI arguments.
    
    Priority: CLI args > config file > defaults.
    Default config path: config/backend.json (relative to skill-creator root).
    """
    config_dict = {}
    
    # Try default config path if no path provided
    if config_path is None:
        # Try to find config/backend.json relative to this script
        script_dir = Path(__file__).parent
        default_config = script_dir.parent / "config" / "backend.json"
        if default_config.exists():
            config_path = default_config
    
    if config_path and config_path.exists():
        try:
            full_config = json.loads(config_path.read_text())
            # Use "default" profile if available
            if "default" in full_config:
                config_dict = full_config["default"]
            else:
                config_dict = full_config
        except Exception as e:
            print(f"Warning: Could not load config from {config_path}: {e}", file=sys.stderr)
    
    if backend_type:
        config_dict["type"] = backend_type
    if model:
        config_dict["model"] = model
    
    backend_type_enum = BackendType(config_dict.get("type", "claude"))
    
    return BackendConfig(
        type=backend_type_enum,
        model=config_dict.get("model"),
        api_key=config_dict.get("api_key"),
        base_url=config_dict.get("base_url"),
        timeout=config_dict.get("timeout", 300),
        extra_kwargs=config_dict.get("extra_kwargs", {})
    )
