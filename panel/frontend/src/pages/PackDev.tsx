// ============================================================================
// PackDev — Pack 开发页面（公开路由）
// 自定义游戏 Pack 开发指南
// ============================================================================

import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../docs-pages.css';
import { getBuildFooterText } from '../utils/buildFooterText';

export default function PackDev() {
  useDocumentTitle('Pack 开发 - GSP');

  return (
    <div className="docs-page">
      <nav className="docs-nav">
        <div className="docs-nav-inner">
          <Link to="/" className="docs-logo">
            <span className="docs-logo-ic">🎮</span>
            <span>GSP</span>
          </Link>
          <div className="docs-nav-links">
            <Link to="/docs">文档</Link>
            <Link to="/api-reference">API</Link>
            <Link to="/pack-dev">Pack 开发</Link>
            <Link to="/community">社区</Link>
          </div>
          <Link to="/login" className="docs-nav-cta">登录 →</Link>
        </div>
      </nav>

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <div className="docs-hero-tag">📦 Pack 开发</div>
          <h1>自定义游戏 Pack</h1>
          <p>YAML 驱动的游戏接入，无需编写代码即可支持新游戏</p>
        </div>
      </div>

      <div className="docs-content">
        <div className="docs-section">
          <h2>Pack 结构</h2>
          <p>每个游戏 Pack 是一个包含 <code>pack.yaml</code> 的目录：</p>
          <pre><code>{`minecraft/
├── pack.yaml          # Pack 配置文件
├── icon.png           # 游戏图标（可选）
└── templates/         # 配置文件模板（可选）
    └── server.properties`}</code></pre>
        </div>

        <div className="docs-section">
          <h2>pack.yaml 示例</h2>
          <pre><code>{`name: Minecraft
version: "1.20.4"
type: java
engine: vanilla

install:
  command: |
    curl -o server.jar https://piston-data.mojang.com/...
    echo "eula=true" > eula.txt

run:
  command: java -Xms1G -Xmx2G -jar server.jar nogui
  port: 25565

config_files:
  - path: server.properties
    format: properties`}</code></pre>
        </div>

        <div className="docs-section">
          <h2>字段说明</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>name</code></td>
                <td>string</td>
                <td>游戏名称</td>
              </tr>
              <tr>
                <td><code>version</code></td>
                <td>string</td>
                <td>游戏版本</td>
              </tr>
              <tr>
                <td><code>type</code></td>
                <td>string</td>
                <td>游戏类型：java / bedrock / native</td>
              </tr>
              <tr>
                <td><code>install.command</code></td>
                <td>string</td>
                <td>安装命令（支持多行）</td>
              </tr>
              <tr>
                <td><code>run.command</code></td>
                <td>string</td>
                <td>启动命令</td>
              </tr>
              <tr>
                <td><code>run.port</code></td>
                <td>number</td>
                <td>默认端口</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="docs-section">
          <h2>变量替换</h2>
          <p>命令中可使用以下变量：</p>
          <ul className="docs-list">
            <li><code>{'{{instance_root}}'}</code> - 实例根目录</li>
            <li><code>{'{{port}}'}</code> - 实例端口</li>
            <li><code>{'{{memory}}'}</code> - 内存限制</li>
            <li><code>{'{{java_path}}'}</code> - Java 路径</li>
          </ul>
        </div>

        <div className="docs-section">
          <h2>贡献 Pack</h2>
          <p>欢迎将你开发的 Pack 提交到官方仓库，帮助更多服主。详见 <Link to="/community">贡献指南</Link>。</p>
        </div>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer-inner">
            <span>{getBuildFooterText()}</span>
          <span>AGPL-3.0 开源</span>
        </div>
      </footer>
    </div>
  );
}
