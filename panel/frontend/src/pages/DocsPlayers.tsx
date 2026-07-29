import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsPlayers() {
  useDocumentTitle('玩家管理 - GSP');

  return (
    <DocsLayout
      tag="👥 玩家管理"
      title="从绑定到互动的玩家链路"
      description="玩家不是一张订单表。GSP 把绑定、档案、好友和互动行为串成了可运营的数据面。"
      links={[
        {
          to: '/docs/shop',
          title: '商城配置',
          description: '权益配置完成后，最终都要回到玩家侧发货与消费行为。',
          cta: '查看商城文档 →',
          icon: '💎',
        },
        {
          to: '/community',
          title: '社区资源',
          description: '需要用户反馈、玩法讨论或联动活动时，这里有更多入口。',
          cta: '查看社区 →',
          icon: '💬',
        },
      ]}
    >
      <div className="docs-section">
        <h2>玩家管理包含什么</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>能力</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>玩家绑定</td>
              <td>把账号与具体实例关联起来，作为发货、权益和订单归属的基础。</td>
            </tr>
            <tr>
              <td>玩家档案</td>
              <td>沉淀注册时间、最近活动、VIP 状态和实例关系。</td>
            </tr>
            <tr>
              <td>好友系统</td>
              <td>支持好友请求、在线好友筛选和基础社交关系维护。</td>
            </tr>
            <tr>
              <td>投票 / 互动</td>
              <td>适合和游戏内事件、奖励发放或治理机制联动。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>推荐的管理顺序</h2>
        <ul className="docs-list">
          <li>先定义实例级绑定规则，再让商城、订单、礼包去消费这套关系。</li>
          <li>玩家资料页用于识别核心玩家、最近活跃与绑定范围。</li>
          <li>好友和互动功能更适合在基础档案稳定后逐步开启。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>常见入口</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>入口</th>
              <th>适合场景</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/guild/bind</code></td>
              <td>玩家侧完成实例绑定。</td>
            </tr>
            <tr>
              <td><code>/players/:userId</code></td>
              <td>公开玩家档案页，查看角色资料与互动状态。</td>
            </tr>
            <tr>
              <td><code>/friends</code></td>
              <td>处理好友请求、在线好友与删除好友。</td>
            </tr>
            <tr>
              <td>实例详情的业务运营 Tab</td>
              <td>按单服视角看订单、CDK、投票与行为设置。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>与商城和报表的关系</h2>
        <p>
          玩家绑定是商城发货的前置条件，玩家行为又会回流到运营报表里。所以建议把
          <Link to="/docs/shop"> 商城配置 </Link>
          和
          <Link to="/docs/reports"> 数据看板 </Link>
          一起看。
        </p>
      </div>
    </DocsLayout>
  );
}
