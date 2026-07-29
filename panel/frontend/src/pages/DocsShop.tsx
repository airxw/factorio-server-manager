import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsShop() {
  useDocumentTitle('商城配置 - GSP');

  return (
    <DocsLayout
      tag="💎 商城配置"
      title="VIP、商品与 CDK 的运营闭环"
      description="把服主常用的商城、礼包、聊天触发器和投票奖励收在一套流程里，而不是散落多个插件。"
      links={[
        {
          to: '/docs/players',
          title: '玩家管理',
          description: '商城发货最终会落到玩家绑定、档案和订单行为上。',
          cta: '查看玩家文档 →',
          icon: '👥',
        },
        {
          to: '/docs/reports',
          title: '数据看板',
          description: '想看流水、活跃和留存趋势，可以继续接报表页。',
          cta: '查看报表 →',
          icon: '📊',
        },
      ]}
    >
      <div className="docs-section">
        <h2>功能模块</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>模块</th>
              <th>典型用途</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>VIP / 商品</td>
              <td>售卖权限组、点券、礼包或长期权益。</td>
            </tr>
            <tr>
              <td>CDK 兑换</td>
              <td>活动码、补偿码、联动推广码。</td>
            </tr>
            <tr>
              <td>聊天触发器</td>
              <td>玩家在游戏内输入指令，触发奖励、播报或自动发货。</td>
            </tr>
            <tr>
              <td>投票相关</td>
              <td>与游戏内投票或行为激励联动。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>推荐配置顺序</h2>
        <ul className="docs-list">
          <li>先准备实例和玩家绑定，再上商城与礼包，避免商品卖出后找不到发货对象。</li>
          <li>先定义商品与权益，再配置 CDK 和触发器，让活动发放复用同一套资产。</li>
          <li>最后接入报表，确认销售、兑换和活跃链路都能回收数据。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>后台入口建议</h2>
        <p>商城配置通常围绕实例详情页展开，适合按单服运营节奏去调。</p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>入口</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/instances/:id</code></td>
              <td>实例详情总入口，适合查看当前服状态与配置。</td>
            </tr>
            <tr>
              <td>业务运营 Tab</td>
              <td>包含商城、订单、CDK、聊天触发器、投票设置等子模块。</td>
            </tr>
            <tr>
              <td><code>/guild/shop</code></td>
              <td>玩家侧商城入口，适合核对前台购买体验。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>常见落地方式</h2>
        <ul className="docs-list">
          <li>新服开服礼包：商品 0 元或限时折扣，配合 CDK 批量投放。</li>
          <li>老玩家召回：聊天触发器和定向权益一起使用，让回流奖励可自动发放。</li>
          <li>活动联动：同一批商品同时支持商城购买和 CDK 兑换，减少重复维护。</li>
        </ul>
        <p>
          发货对象、档案与绑定策略建议同步参考 <Link to="/docs/players">玩家管理文档</Link>。
        </p>
      </div>
    </DocsLayout>
  );
}
