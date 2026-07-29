// ============================================================================
// GameCommandHelp — 游戏内命令帮助页面
// 展示所有可在游戏内控制台使用的命令及其用法
// 关联说明：系统内置命令（!register/!verify/!claim/!vk 等）由面板硬编码实现业务逻辑，
//          不可在「聊天触发响应」页面修改；自定义文本触发响应请前往该页面配置。
// ============================================================================

interface CommandInfo {
  cmd: string;
  desc: string;
  example: string;
  detail: string;
  /** 命令类别：system=系统内置（执行业务逻辑），query=查询类（只读） */
  category: 'system' | 'query';
}

const COMMANDS: CommandInfo[] = [
  {
    cmd: '!register',
    desc: '注册面板账号',
    example: '!register user@example.com mypassword',
    detail:
      '在游戏内直接注册面板账号。用户名默认使用游戏玩家名。也可指定用户名：!register user@example.com MyName mypassword。注册后需前往 Web 面板登录并使用 !verify 完成绑定验证。',
    category: 'system',
  },
  {
    cmd: '!verify',
    desc: '绑定游戏账号到面板',
    example: '!verify ABC123',
    detail:
      '在 Web 面板「个人设置 → 玩家绑定验证」生成验证码后，在游戏内发送此命令完成绑定。绑定后自动获得 VIP1 等级。验证码有效期 5 分钟。',
    category: 'system',
  },
  {
    cmd: '!claim',
    desc: '兑换 CDK 物品',
    example: '!claim WELCOME2026',
    detail:
      '在游戏内兑换 CDK 兑换码。管理员在 Web 面板「CDK 管理」生成兑换码后分发给玩家，玩家在游戏内使用此命令领取物品。',
    category: 'system',
  },
  {
    cmd: '!vk',
    desc: '发起投票踢人',
    example: '!vk ProblemPlayer',
    detail:
      '在游戏内发起针对某玩家的投票踢人。需要管理员先在「投票踢人设置」中启用。投票达到阈值后目标玩家将被自动踢出。',
    category: 'system',
  },
  {
    cmd: '!vk yes',
    desc: '投票赞成',
    example: '!vk yes',
    detail: '对当前进行中的投票投赞成票。也可简写为 !vk。',
    category: 'system',
  },
  {
    cmd: '!vk no',
    desc: '投票反对',
    example: '!vk no',
    detail: '对当前进行中的投票投反对票。',
    category: 'system',
  },
  {
    cmd: '!help',
    desc: '查看可用命令',
    example: '!help',
    detail: '在游戏内查看所有可用命令列表。',
    category: 'query',
  },
  {
    cmd: '!status',
    desc: '查看服务器状态',
    example: '!status',
    detail: '查询当前服务器运行状态。',
    category: 'query',
  },
  {
    cmd: '!players',
    desc: '查看在线玩家',
    example: '!players',
    detail: '查询当前在线玩家列表。',
    category: 'query',
  },
  {
    cmd: '!uptime',
    desc: '查看运行时长',
    example: '!uptime',
    detail: '查询服务器已运行时长。',
    category: 'query',
  },
];

const CATEGORY_LABEL: Record<CommandInfo['category'], string> = {
  system: '系统内置',
  query: '查询类',
};

export default function GameCommandHelp() {
  const systemCommands = COMMANDS.filter((c) => c.category === 'system');
  const queryCommands = COMMANDS.filter((c) => c.category === 'query');

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">游戏内命令帮助</h2>
      </div>

      <div className="alert alert-info">
        玩家在游戏内控制台输入以 <code>!</code>{' '}
        开头的命令即可使用以下功能。所有命令均在游戏内聊天中发送，无需打开 Web 面板。
        <br />
        <strong>命令分类：</strong>
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
          <li>
            <strong>系统内置命令</strong>：由面板硬编码实现业务逻辑（注册/绑定/兑换/投票等），
            <strong>不可</strong>在「聊天触发响应」页面修改。
          </li>
          <li>
            <strong>查询类命令</strong>：只读查询服务器状态，不修改数据。
          </li>
          <li>
            <strong>自定义触发响应</strong>
            ：如需配置关键词自动回复文本，请前往「聊天触发响应」页面配置（与系统命令独立，不冲突）。
          </li>
        </ul>
      </div>

      {/* 系统内置命令 */}
      <div className="info-card">
        <h3 className="card-title">
          系统内置命令
          <span className="badge badge-starting" style={{ marginLeft: 8 }}>
            不可修改
          </span>
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>命令</th>
              <th>说明</th>
              <th>示例</th>
              <th>类别</th>
            </tr>
          </thead>
          <tbody>
            {systemCommands.map((c) => (
              <tr key={c.cmd}>
                <td>
                  <code>{c.cmd}</code>
                </td>
                <td>{c.desc}</td>
                <td>
                  <code>{c.example}</code>
                </td>
                <td>
                  <span className="badge badge-running">{CATEGORY_LABEL[c.category]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 查询类命令 */}
      <div className="info-card" style={{ marginTop: 16 }}>
        <h3 className="card-title">查询类命令</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>命令</th>
              <th>说明</th>
              <th>示例</th>
              <th>类别</th>
            </tr>
          </thead>
          <tbody>
            {queryCommands.map((c) => (
              <tr key={c.cmd}>
                <td>
                  <code>{c.cmd}</code>
                </td>
                <td>{c.desc}</td>
                <td>
                  <code>{c.example}</code>
                </td>
                <td>
                  <span className="badge badge-stopped">{CATEGORY_LABEL[c.category]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="info-card" style={{ marginTop: 16 }}>
        <h3 className="card-title">详细说明</h3>
        {COMMANDS.map((c) => (
          <div
            key={c.cmd}
            className="info-row"
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
          >
            <div>
              <code style={{ fontWeight: 'bold' }}>{c.cmd}</code> — {c.desc}
              <span className="badge badge-starting" style={{ marginLeft: 8 }}>
                {CATEGORY_LABEL[c.category]}
              </span>
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #999)' }}>
              {c.detail}
            </div>
            <div style={{ fontSize: '0.875rem', marginTop: 4 }}>
              示例: <code>{c.example}</code>
            </div>
          </div>
        ))}
      </div>

      <div className="info-card" style={{ marginTop: 16 }}>
        <h3 className="card-title">玩家操作流程</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>
            <strong>注册</strong>：游戏内输入 <code>!register your@email.com yourpassword</code>
            <br />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #999)' }}>
              系统自动创建面板账号和 pending 玩家绑定记录
            </span>
          </li>
          <li>
            <strong>登录 Web 面板</strong>：使用注册的邮箱和密码登录
            <br />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #999)' }}>
              在「个人设置 → 玩家绑定验证」页面生成新的验证码
            </span>
          </li>
          <li>
            <strong>绑定验证</strong>：回到游戏内输入 <code>!verify ABC123</code>
            <br />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #999)' }}>
              绑定成功后自动获得 VIP1 等级
            </span>
          </li>
          <li>
            <strong>兑换物品</strong>：管理员发放 CDK 后，游戏内输入 <code>!claim WELCOME2026</code>
          </li>
          <li>
            <strong>投票踢人</strong>：游戏内输入 <code>!vk ProblemPlayer</code>{' '}
            发起投票，其他玩家输入 <code>!vk yes</code> 赞成
          </li>
        </ol>
      </div>
    </div>
  );
}
