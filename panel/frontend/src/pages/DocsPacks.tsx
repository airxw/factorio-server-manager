import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsPacks() {
  useDocumentTitle('游戏 Pack - GSP');

  return (
    <DocsLayout
      tag="🎮 游戏 Pack"
      title="Pack 安装与运维说明"
      description="当前内置 9 款官方 Pack，覆盖常见 Steam、Java 与原生二进制服务器。"
      links={[
        {
          to: '/pack-dev',
          title: 'Pack 开发',
          description: '需要自定义 pack.yaml、启动命令或版本源时，从开发文档开始。',
          cta: '查看开发文档 →',
          icon: '🧩',
        },
        {
          to: '/docs/config',
          title: '环境准备',
          description: '先把节点、SSL 和数据库配好，再批量上游戏实例。',
          cta: '查看配置 →',
          icon: '⚙️',
        },
      ]}
    >
      <div className="docs-section">
        <h2>当前内置 Pack</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Pack ID</th>
              <th>游戏</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>minecraft-vanilla</code></td><td>Minecraft</td><td>Java 服务端，适合纯净服。</td></tr>
            <tr><td><code>palworld-vanilla</code></td><td>Palworld</td><td>Steam 平台游戏，适合生存服。</td></tr>
            <tr><td><code>rust-vanilla</code></td><td>Rust</td><td>官方 Rust Dedicated Server。</td></tr>
            <tr><td><code>ark-vanilla</code></td><td>ARK</td><td>适合经典生存服部署。</td></tr>
            <tr><td><code>valheim-vanilla</code></td><td>Valheim</td><td>小团队常用生存类实例。</td></tr>
            <tr><td><code>zomboid-vanilla</code></td><td>Project Zomboid</td><td>含常规启动与世界目录约定。</td></tr>
            <tr><td><code>factorio-vanilla</code></td><td>Factorio</td><td>偏工业自动化场景。</td></tr>
            <tr><td><code>terraria-vanilla</code></td><td>Terraria</td><td>原版 Terraria 服务器。</td></tr>
            <tr><td><code>terraria-tshock</code></td><td>Terraria + TShock</td><td>适合需要管理插件能力的 Terraria 服。</td></tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>标准上线流程</h2>
        <ul className="docs-list">
          <li>在创建实例时选择节点与 Pack，系统会按 Pack 约定拉起安装命令。</li>
          <li>首次启动前，先检查启动路径、世界目录、端口占用和依赖运行时。</li>
          <li>Steam 游戏优先确保节点上可用 <code>steamcmd</code>；Java 游戏先确认 JRE/JDK 版本。</li>
        </ul>
        <pre>
          <code>{`# 适合用于排查节点环境
java -version
steamcmd +quit
df -h
free -m`}</code>
        </pre>
      </div>

      <div className="docs-section">
        <h2>什么时候要自定义 Pack</h2>
        <p>出现以下情况时，建议转到 <Link to="/pack-dev">Pack 开发文档</Link>：</p>
        <ul className="docs-list">
          <li>官方版本源抓不到你要的游戏版本。</li>
          <li>启动命令需要额外参数、预启动脚本或自定义 ready pattern。</li>
          <li>你要暴露新的面板 Tab、配置表单或管理命令。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>升级建议</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>场景</th>
              <th>建议做法</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>下载新版本</td>
              <td>先在版本管理里下载，再到实例详情里执行应用或回滚。</td>
            </tr>
            <tr>
              <td>修改安装命令</td>
              <td>优先在 pack.yaml 中修，不要在节点上临时手改脚本。</td>
            </tr>
            <tr>
              <td>新增游戏支持</td>
              <td>先补 Pack 契约，再补启动、停止和版本检查链路。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocsLayout>
  );
}
