import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsDaemon() {
  useDocumentTitle('Daemon 节点 - GSP');

  return (
    <DocsLayout
      tag="🛰️ Daemon 节点"
      title="节点部署与连接检查"
      description="Panel 负责控制面，Daemon 负责真实执行。把这条链路配通，远程节点能力才算真的落地。"
      links={[
        {
          to: '/docs/config',
          title: '配置拓扑',
          description: '先看入口、反代和内部端口的关系，部署时更不容易走偏。',
          cta: '回到配置页 →',
          icon: '⚙️',
        },
        {
          to: '/docs/packs',
          title: 'Pack 管理',
          description: '节点可用后，Pack 的安装、更新和运行才有承载环境。',
          cta: '查看 Pack 文档 →',
          icon: '🎮',
        },
      ]}
    >
      <div className="docs-section">
        <h2>一条完整链路</h2>
        <ul className="docs-list">
          <li>在 Panel 的节点页生成邀请。</li>
          <li>在目标服务器执行 bootstrap 脚本或部署命令。</li>
          <li>Daemon 注册成功后，Panel 才会把实例下发到该节点。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>关键约定</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>项</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Daemon 默认监听</td>
              <td><code>127.0.0.1:8080</code>，不对公网开放。</td>
            </tr>
            <tr>
              <td>Panel 内部回源</td>
              <td>由 Panel 通过节点配置直接访问，不需要浏览器参与。</td>
            </tr>
            <tr>
              <td>健康检查</td>
              <td>优先检查节点本机的 <code>/health</code> 响应与版本信息。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>部署后先做这几个检查</h2>
        <pre>
          <code>{`# 在节点服务器本机执行
curl http://127.0.0.1:8080/health
systemctl status gameserver-daemon
ss -lntp | grep 8080`}</code>
        </pre>
        <ul className="docs-list">
          <li>健康检查通了，再回 Panel 看节点是否从 pending 变成 online。</li>
          <li>如果节点已注册但实例起不来，优先查节点磁盘、Java、SteamCMD 和目录权限。</li>
          <li>如果邀请过期，直接在节点页重新生成，不要复用旧链接。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>和哪些页面配合使用</h2>
        <p>
          节点接入完成后，你通常会继续去 <Link to="/docs/packs">Pack 文档</Link> 看安装与升级，
          或回到 <Link to="/docs/config">配置指南</Link> 补齐 SSL、域名和反向代理。
        </p>
      </div>
    </DocsLayout>
  );
}
