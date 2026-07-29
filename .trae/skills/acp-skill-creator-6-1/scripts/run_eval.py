#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes the model to trigger (read the skill)
for a set of queries. Outputs results as JSON.
"""

import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

from scripts.model_runner import (
    BackendConfig,
    BackendType,
    BaseModelRunner,
    ModelRunnerFactory,
    load_backend_config,
)
from scripts.utils import parse_skill_md


# Global worker function for Windows ProcessPoolExecutor compatibility
# Must be at module top-level to be picklable
def _query_worker_fn(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None,
    backend_config_dict: dict | None,
):
    """Top-level worker function for Windows compatibility."""
    backend_config = None
    if backend_config_dict:
        try:
            backend_config = BackendConfig(
                type=BackendType(backend_config_dict["type"]),
                model=backend_config_dict.get("model"),
                api_key=backend_config_dict.get("api_key"),
                base_url=backend_config_dict.get("base_url"),
                timeout=backend_config_dict.get("timeout", 300),
                extra_kwargs=backend_config_dict.get("extra_kwargs", {})
            )
        except Exception:
            pass
    
    if backend_config is None:
        backend_config = BackendConfig(
            type=BackendType.CLAUDE,
            model=model,
            timeout=timeout
        )
    
    worker_runner = ModelRunnerFactory.create(backend_config)
    
    skill_context = {
        "skill_name": skill_name,
        "skill_description": skill_description,
        "timeout": timeout,
    }
    
    triggered, _ = worker_runner.run_stream_query(query, skill_context=skill_context)
    return triggered


def _get_runner(
    model: Optional[str] = None,
    backend_type: str = "claude",
    config_path: Optional[Path] = None,
) -> BaseModelRunner:
    """Get a model runner instance, either from existing or create new."""
    backend_config = load_backend_config(
        config_path=config_path,
        backend_type=backend_type,
        model=model
    )
    return ModelRunnerFactory.create(backend_config)


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
    runner: Optional[BaseModelRunner] = None,
    backend_config: Optional[BackendConfig] = None,
) -> bool:
    """Run a single query and return whether the skill was triggered.
    
    Uses the configured model backend to test trigger detection.
    """
    # Backward compatibility: if no runner provided, create one
    if runner is None:
        if backend_config is None:
            backend_config = BackendConfig(
                type=BackendType.CLAUDE,
                model=model,
                timeout=timeout
            )
        runner = ModelRunnerFactory.create(backend_config)
    
    skill_context = {
        "skill_name": skill_name,
        "skill_description": skill_description,
        "timeout": timeout,
    }
    
    triggered, _ = runner.run_stream_query(query, skill_context=skill_context)
    return triggered


def _backend_config_to_dict(config: BackendConfig) -> dict:
    """Convert BackendConfig to a picklable dict for workers."""
    return {
        "type": config.type.value,
        "model": config.model,
        "api_key": config.api_key,
        "base_url": config.base_url,
        "timeout": config.timeout,
        "extra_kwargs": config.extra_kwargs,
    }


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
    runner: Optional[BaseModelRunner] = None,
    backend_config: Optional[BackendConfig] = None,
) -> dict:
    """Run the full eval set and return results."""
    results = []
    
    # Prepare config dict for workers
    worker_backend_config_dict = None
    if backend_config:
        worker_backend_config_dict = _backend_config_to_dict(backend_config)
    
    # Use top-level worker function for Windows compatibility
    def _query_worker(item, run_idx):
        return _query_worker_fn(
            item["query"],
            skill_name,
            description,
            timeout,
            str(project_root),
            model,
            worker_backend_config_dict,
        )

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        future_to_info = {}
        for item in eval_set:
            for run_idx in range(runs_per_query):
                future = executor.submit(
                    _query_worker,
                    item,
                    run_idx,
                )
                future_to_info[future] = (item, run_idx)

        query_triggers: dict[str, list[bool]] = {}
        query_items: dict[str, dict] = {}
        for future in as_completed(future_to_info):
            item, _ = future_to_info[future]
            query = item["query"]
            query_items[query] = item
            if query not in query_triggers:
                query_triggers[query] = []
            try:
                query_triggers[query].append(future.result())
            except Exception as e:
                print(f"Warning: query failed: {e}", file=sys.stderr)
                query_triggers[query].append(False)

    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers)
        should_trigger = item["should_trigger"]
        if should_trigger:
            did_pass = trigger_rate >= trigger_threshold
        else:
            did_pass = trigger_rate < trigger_threshold
        results.append({
            "query": query,
            "should_trigger": should_trigger,
            "trigger_rate": trigger_rate,
            "triggers": sum(triggers),
            "runs": len(triggers),
            "pass": did_pass,
        })

    passed = sum(1 for r in results if r["pass"])
    total = len(results)

    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Run trigger evaluation for a skill description")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
    parser.add_argument("--model", default=None, help="Model to use (default: user's configured model)")
    parser.add_argument("--backend", default="claude", help="Backend type (claude, gpt, gemini, openai_compatible)")
    parser.add_argument("--config", default=None, help="Path to backend config JSON file")
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())
    skill_path = Path(args.skill_path)

    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    name, original_description, content = parse_skill_md(skill_path)
    description = args.description or original_description
    
    # Load backend config
    config_path = Path(args.config) if args.config else None
    backend_config = load_backend_config(
        config_path=config_path,
        backend_type=args.backend,
        model=args.model
    )
    runner = ModelRunnerFactory.create(backend_config)
    
    # Project root is handled by the runner itself now
    project_root = Path.cwd()

    if args.verbose:
        print(f"Evaluating: {description}", file=sys.stderr)

    output = run_eval(
        eval_set=eval_set,
        skill_name=name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
        runner=runner,
        backend_config=backend_config,
    )

    if args.verbose:
        summary = output["summary"]
        print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
        for r in output["results"]:
            status = "PASS" if r["pass"] else "FAIL"
            rate_str = f"{r['triggers']}/{r['runs']}"
            print(f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:70]}", file=sys.stderr)

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
