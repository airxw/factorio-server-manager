import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsConfig() {
  useDocumentTitle('配置指南 - GSP');

  return (
    <DocsLayout
      tag="⚙️ 配置指南"
      title="部署拓扑与核心配置"
      description="把访问入口、数据库、SSL 和 Daemon 节点一次配清楚，避免把内部地址暴露给浏览器。"
      links={[
        {
          to: '/docs/daemon',
          title: 'Daemon 节点部署',
          description: '远程节点邀请、部署脚本与健康检查。',
          cta: '查看节点文档 →',
          icon: '🛰️',
        },
        {
          to: '/api-reference',
          title: 'API 参考',
          description: '需要对接自动化或外部系统时，从这里查接口。',
          cta: '查看 API →',
          icon: '🔌',
        },
      ]}
    >
      <div className="docs-section">
        <h2>访问入口</h2>
        <p>浏览器端请始终走 HTTPS 主入口，Panel 后端的内部监听地址仅用于服务器本机通信。</p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>用途</th>
              <th>地址</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>公网访问</td>
              <td><code>https://gsp.ecsrz.com:3001</code></td>
              <td>正式入口，浏览器、玩家和服主都从这里进入。</td>
            </tr>
            <tr>
              <td>局域网访问</td>
              <td><code>https://192.168.5.23:3001</code></td>
              <td>同一台服务器的局域网入口。</td>
            </tr>
            <tr>
              <td>HTTP 跳转入口</td>
              <td><code>http://gsp.ecsrz.com:3000</code></td>
              <td>仅负责 301 跳转到 HTTPS。</td>
            </tr>
            <tr>
              <td>Panel 内部端口</td>
              <td><code>http://127.0.0.1:3002</code></td>
              <td>只允许服务器本机访问，禁止写进前端配置。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>数据库配置</h2>
        <p>开发环境默认可用 SQLite，生产环境建议切到 MySQL 8.0+ 或 PostgreSQL 14+。</p>
        <ul className="docs-list">
          <li>首次部署先完成数据库连通性检查，再执行迁移脚本。</li>
          <li>升级版本前先看迁移内容，字段变更要准备热更新前置脚本。</li>
          <li>备份数据库与上传目录，再执行升级或结构调整。</li>
        </ul>
        <pre>
          <code>{`# 健康检查（服务器本机）
curl http://127.0.0.1:3002/api/health

# 常见环境变量
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=gameserver_panel`}</code>
        </pre>
      </div>

      <div className="docs-section" id="ssl">
        <h2>SSL 与域名</h2>
        <p>推荐使用统一域名 + nginx 反向代理。证书部署完成后，再把浏览器访问切到 <code>:3001</code>。</p>
        <ul className="docs-list">
          <li>nginx 监听 <code>0.0.0.0:3000</code>，只做 HTTP 到 HTTPS 的跳转。</li>
          <li>nginx 监听 <code>0.0.0.0:3001</code>，把请求反代到 <code>127.0.0.1:3002</code>。</li>
          <li>WebSocket 路径 <code>/ws</code> 也由 nginx 透传，不需要前端单独改地址。</li>
        </ul>
        <p>
          如果你还没完成节点侧部署，可以接着看 <Link to="/docs/daemon">Daemon 指南</Link>。
        </p>
      </div>

      <div className="docs-section">
        <h2>后台设置入口</h2>
        <p>登录后常用的配置入口基本集中在以下位置：</p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>入口</th>
              <th>用途</th>
              <th>适合谁</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/admin/settings</code></td>
              <td>系统配置、站点信息、运行时开关。</td>
              <td>平台管理员</td>
            </tr>
            <tr>
              <td><code>/admin/ssl</code></td>
              <td>证书、域名和 HTTPS 相关配置。</td>
              <td>平台管理员</td>
            </tr>
            <tr>
              <td><code>/admin/nodes</code></td>
              <td>节点邀请、节点归属与部署状态。</td>
              <td>平台管理员 / 实例管理员</td>
            </tr>
            <tr>
              <td><code>/setup</code></td>
              <td>首次初始化向导，适合新安装环境。</td>
              <td>首次部署者</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>排错顺序</h2>
        <ul className="docs-list">
          <li>先确认浏览器访问的是 <code>https://...:3001</code>，不要误用浏览器本机的开发地址。</li>
          <li>再看 nginx 是否正常把请求转到 <code>127.0.0.1:3002</code>。</li>
          <li>最后检查数据库连接、节点状态和 WebSocket 是否连通。</li>
        </ul>
      </div>
    </DocsLayout>
  );
}
