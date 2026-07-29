import { IExecutionEngine } from '../interface_stub/asset_interfaces';

export class MockExecutionEngine implements IExecutionEngine {
  async executeLogic(instanceId: string, logicString: string, variables: Record<string, string>): Promise<boolean> {
    if (!instanceId) {
      throw new Error('ERR_INSTANCE_NOT_FOUND');
    }

    // 注入校验
    if (!logicString.match(/^[a-zA-Z0-9_\{\} ]+$/)) {
      throw new Error('ERR_RCON_INJECTION');
    }

    // 变量替换
    let finalCommand = logicString;
    for (const [key, value] of Object.entries(variables)) {
      finalCommand = finalCommand.replace(`{${key}}`, value);
    }

    console.log(`[MOCK EXECUTION] Instance: ${instanceId} | Executing RCON: ${finalCommand}`);
    
    // 模拟特殊错误场景：如果包含 error 关键字则模拟执行失败
    if (finalCommand.includes('error')) {
      throw new Error('ERR_EXECUTION_FAILED');
    }

    return true;
  }
}