import { createServer, type Server, type Socket } from 'node:net';

// ============================================================================
// Mock RCON Server - 实现 Source RCON 协议用于测试
// 来源：从 poc/rcon-client/mock-server.ts 迁移
// 协议规范: https://developer.valvesoftware.com/wiki/Source_RCON_Protocol
// 包结构: [Size:4LE][ID:4LE][Type:4LE][Body:变长][NullTerm:2]
//
// 用途：Daemon 单元测试和 E2E 测试共用
// 使用方式：调用 startMockRconServer() 启动，返回 Server 实例可 close()
// ============================================================================

const SERVER_AUTH = 3;
const SERVER_AUTH_RESPONSE = 2;
const SERVER_EXECCOMMAND = 2;
const SERVER_EXEC_RESPONSE = 0;

interface RconPacket {
  size: number;
  id: number;
  type: number;
  body: string;
}

function parsePacket(buf: Buffer): RconPacket | null {
  if (buf.length < 12) return null;
  const size = buf.readInt32LE(0);
  if (buf.length < 4 + size) return null; // 不完整
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  // body 从 offset 12 开始, 长度 = size - 10 (id+type+2null)
  const body = buf.subarray(12, 4 + size - 2).toString('utf8');
  return { size, id, type, body };
}

function buildPacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  // 末尾两个 null byte 已经是 0
  return buf;
}

interface CommandHandler {
  match: RegExp;
  respond: (cmd: string) => string;
}

// 模拟真实 Minecraft 服务器命令响应
const commandHandlers: CommandHandler[] = [
  { match: /^list$/, respond: () => 'There are 3 of a max of 20 players online: Steve, Alex, Notch' },
  { match: /^say .+$/, respond: (cmd) => `[Server] ${cmd.replace(/^say /, '')}` },
  { match: /^give (\w+) (\w+) (\d+)$/, respond: (cmd) => {
    const m = cmd.match(/^give (\w+) (\w+) (\d+)$/);
    if (!m) return 'Invalid command';
    return `Given ${m[3]} ${m[2]} to ${m[1]}`;
  }},
  { match: /^time set (\w+)$/, respond: (cmd) => {
    const m = cmd.match(/^time set (\w+)$/);
    if (!m) return 'Invalid command';
    return `Set the time to ${m[1]}`;
  }},
  { match: /^weather (\w+)$/, respond: (cmd) => {
    const m = cmd.match(/^weather (\w+)$/);
    if (!m) return 'Invalid command';
    return `Changing to ${m[1]} weather`;
  }},
  { match: /^kick (\w+)/, respond: (cmd) => {
    const m = cmd.match(/^kick (\w+)/);
    if (!m) return 'Invalid command';
    return `Kicked ${m[1]}`;
  }},
  { match: /^op (\w+)$/, respond: (cmd) => {
    const m = cmd.match(/^op (\w+)$/);
    if (!m) return 'Invalid command';
    return `Made ${m[1]} a server operator`;
  }},
  { match: /^save-off$/, respond: () => 'Automatic saving is now disabled' },
  { match: /^save-on$/, respond: () => 'Automatic saving is now enabled' },
  { match: /^save-all$/, respond: () => 'Saving the game (this may take a moment!)' },
];

function handleCommand(cmd: string): string {
  for (const h of commandHandlers) {
    if (h.match.test(cmd)) return h.respond(cmd);
  }
  return 'Unknown command. Type "help" for help.';
}

export interface MockRconOptions {
  port?: number;
  host?: string;
  password?: string;
}

export const DEFAULT_MOCK_RCON_PORT = 25575;
export const DEFAULT_MOCK_RCON_PASSWORD = 'poc-test-password';

// 启动 Mock RCON Server，返回 Server 实例（调用方可 .close() 关闭）
export function startMockRconServer(options: MockRconOptions = {}): Server {
  const port = options.port ?? DEFAULT_MOCK_RCON_PORT;
  const host = options.host ?? '127.0.0.1';
  const password = options.password ?? DEFAULT_MOCK_RCON_PASSWORD;

  const server = createServer((socket: Socket) => {
    let authenticated = false;
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[mock-rcon] 客户端连接 ${clientAddr}`);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // 循环处理完整的数据包
      while (buffer.length >= 12) {
        const packet = parsePacket(buffer);
        if (!packet) break;

        const consumed = 4 + packet.size;
        buffer = buffer.subarray(consumed);

        if (packet.type === SERVER_AUTH) {
          if (packet.body === password) {
            authenticated = true;
            console.log(`[mock-rcon] ${clientAddr} 认证成功`);
            // 真实服务器先发空 type=0 响应, 再发 type=2 auth response
            socket.write(buildPacket(packet.id, SERVER_EXEC_RESPONSE, ''));
            socket.write(buildPacket(packet.id, SERVER_AUTH_RESPONSE, ''));
          } else {
            console.log(`[mock-rcon] ${clientAddr} 认证失败`);
            // 认证失败: 返回 id=-1
            socket.write(buildPacket(-1, SERVER_AUTH_RESPONSE, ''));
          }
        } else if (packet.type === SERVER_EXECCOMMAND) {
          if (!authenticated) {
            socket.write(buildPacket(packet.id, SERVER_EXEC_RESPONSE, 'Not authenticated'));
            continue;
          }
          const cmd = packet.body.trim();
          console.log(`[mock-rcon] ${clientAddr} 执行命令: ${cmd}`);
          const response = handleCommand(cmd);
          socket.write(buildPacket(packet.id, SERVER_EXEC_RESPONSE, response));
        }
      }
    });

    socket.on('end', () => console.log(`[mock-rcon] ${clientAddr} 断开`));
    socket.on('error', (e: Error) => console.error(`[mock-rcon] ${clientAddr} 错误: ${e.message}`));
  });

  server.listen(port, host, () => {
    console.log(`[mock-rcon] RCON mock server listening on ${host}:${port}`);
    console.log(`[mock-rcon] 密码: ${password}`);
    console.log(`[mock-rcon] 支持命令: list, say <msg>, give <player> <item> <n>, time set <t>, weather <w>, kick <p>, op <p>, save-off/on/all`);
  });

  server.on('error', (e: Error) => {
    console.error(`[mock-rcon] 服务器错误: ${e.message}`);
  });

  return server;
}
