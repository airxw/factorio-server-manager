import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IExecutionEngine } from '../../../../public/interface_stub/asset_interfaces.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IInstanceCommandSender {
  sendCommand(id: string, command: string): Promise<string | null>;
}

export class ExecutionEngine implements IExecutionEngine {
  private allowedPatterns: RegExp[] = [];

  constructor(private readonly instanceManager: IInstanceCommandSender) {
    this.loadAllowedPatterns();
  }

  private loadAllowedPatterns() {
    try {
      const schemaPath = path.resolve(__dirname, '../../../../public/config_template/commercial_config.schema.json');
      const content = fs.readFileSync(schemaPath, 'utf8');
      const schema = JSON.parse(content);
      const patterns = schema.properties?.rcon_sandbox_allowed_patterns?.default as string[];
      if (Array.isArray(patterns)) {
        this.allowedPatterns = patterns.map(p => new RegExp(p));
      } else {
        this.allowedPatterns = [new RegExp('^[a-zA-Z0-9_\\{\\} ]+$')];
      }
    } catch (err) {
      this.allowedPatterns = [new RegExp('^[a-zA-Z0-9_\\{\\} ]+$')];
    }
  }

  async executeLogic(instanceId: string, logicString: string, variables: Record<string, string>): Promise<boolean> {
    const command = logicString.replace(/\{([^}]+)\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        return variables[key];
      }
      return match;
    });

    let allowed = false;
    for (const pattern of this.allowedPatterns) {
      if (pattern.test(command)) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      throw new Error('ERR_RCON_INJECTION');
    }

    try {
      await this.instanceManager.sendCommand(instanceId, command);
      return true;
    } catch (err) {
      throw new Error('ERR_EXECUTION_FAILED');
    }
  }
}
