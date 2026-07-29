import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateBootstrapScript } from './bootstrapScriptTemplate.js';

describe('bootstrapScriptTemplate - generateBootstrapScript', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清理测试可能修改的环境变量
    delete process.env.SLAVE_REPO_URL;
    delete process.env.SLAVE_INSTALL_DIR;
    delete process.env.SLAVE_PORT;
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  it('生成包含 #!/bin/bash 头的脚本', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_abc123',
    });
    expect(script.startsWith('#!/bin/bash')).toBe(true);
  });

  it('脚本包含传入的 masterUrl 和 linkKey', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://example.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('https://example.com:3001');
    expect(script).toContain('gsp_link_testkey');
  });

  it('Bug #3 回归：脚本不包含 npm install --production', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    // 原前端脚本 bug：npm install --production 后 npm run build 缺 tsc
    expect(script).not.toContain('npm install --production');
  });

  it('脚本包含 npm install + npm run build + npm prune --production', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('npm install');
    expect(script).toContain('npm run build');
    expect(script).toContain('npm prune --production');
  });

  it('脚本校验构建产物 dist/index.js 存在', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('dist/index.js');
  });

  it('脚本包含 systemd 服务配置', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('gsp-slave-daemon.service');
    expect(script).toContain('Restart=on-failure');
    expect(script).toContain('WantedBy=multi-user.target');
  });

  it('LINK_KEY 通过 heredoc 写入 .env，不通过命令行参数传递', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_secret',
    });
    // .env 文件通过 cat heredoc 写入，不是 LINK_KEY=xxx npm start 形式
    expect(script).toContain('cat > "$INSTALL_DIR/daemon/.env" << EOF');
    // linkKey 明文通过 export 注入 shell 环境变量（运行时再展开到 .env，避免明文出现在 heredoc 中）
    expect(script).toContain('export LINK_KEY="gsp_link_secret"');
    // .env 内通过 $LINK_KEY 引用 shell 变量
    expect(script).toContain('LINK_KEY=$LINK_KEY');
    // 不应出现 LINK_KEY=xxx npm start（命令行参数形式，会进入 shell history）
    expect(script).not.toMatch(/LINK_KEY=\S+\s+npm\s+start/);
  });

  it('默认使用内置仓库地址 / 安装目录 / 端口', () => {
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('https://github.com/airxw/GSP-Panel.git');
    expect(script).toContain('/opt/gsp-slave');
    // 端口通过 export SLAVE_PORT 注入，再在 .env heredoc 中通过 $SLAVE_PORT 引用
    expect(script).toContain('export SLAVE_PORT="8080"');
    expect(script).toContain('PORT=$SLAVE_PORT');
  });

  it('通过环境变量覆盖仓库地址', () => {
    process.env.SLAVE_REPO_URL = 'https://github.com/custom/repo.git';
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('https://github.com/custom/repo.git');
    expect(script).not.toContain('https://github.com/airxw/GSP-Panel.git');
  });

  it('通过环境变量覆盖安装目录', () => {
    process.env.SLAVE_INSTALL_DIR = '/opt/custom-slave';
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    expect(script).toContain('/opt/custom-slave');
    expect(script).not.toContain('/opt/gsp-slave');
  });

  it('通过环境变量覆盖端口', () => {
    process.env.SLAVE_PORT = '9090';
    const script = generateBootstrapScript({
      masterUrl: 'https://gsp.ecsrz.com:3001',
      linkKey: 'gsp_link_testkey',
    });
    // 覆盖后 export SLAVE_PORT 应为 9090
    expect(script).toContain('export SLAVE_PORT="9090"');
    expect(script).toContain('PORT=$SLAVE_PORT');
  });
});
