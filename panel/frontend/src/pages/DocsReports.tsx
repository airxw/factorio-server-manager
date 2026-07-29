import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import DocsLayout from './DocsLayout';

export default function DocsReports() {
  useDocumentTitle('数据看板 - GSP');

  return (
    <DocsLayout
      tag="📊 数据看板"
      title="从流水到系统健康的观测视角"
      description="看得到收入，也看得到在线趋势、数据量变化和系统异常，避免只盯着一个数字做运营。"
      links={[
        {
          to: '/docs/shop',
          title: '商城配置',
          description: '收入报表的上游，来自商品、订单和 CDK 运营动作。',
          cta: '回到商城 →',
          icon: '💎',
        },
        {
          to: '/api-reference',
          title: 'API 参考',
          description: '需要把报表接入外部 BI 或自动化任务时，用 API 文档核对字段。',
          cta: '查看 API →',
          icon: '🔌',
        },
      ]}
    >
      <div className="docs-section">
        <h2>三类常用看板</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>重点</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>流水报表</td>
              <td>看订单、支付、礼包和权益发放是否健康。</td>
            </tr>
            <tr>
              <td>在线趋势</td>
              <td>看玩家活跃、服内热度与峰值波动。</td>
            </tr>
            <tr>
              <td>系统健康</td>
              <td>看服务状态、诊断信息和关键表数据量增长。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>后台入口</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>入口</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/store/reports/revenue</code></td>
              <td>服主视角的收入与商业表现。</td>
            </tr>
            <tr>
              <td><code>/store/reports/playtime</code></td>
              <td>在线趋势、活跃和时长类指标。</td>
            </tr>
            <tr>
              <td><code>/admin/system-health</code></td>
              <td>平台视角的诊断、告警和数据量监控。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="docs-section">
        <h2>怎么读这些数据</h2>
        <ul className="docs-list">
          <li>流水上涨但活跃下滑，通常意味着活动透支或复购不足。</li>
          <li>活跃上涨但转化低，优先回头看商品结构、礼包入口和玩家绑定漏斗。</li>
          <li>系统健康页出现数据量告警时，要同时安排归档、清理或分页治理。</li>
        </ul>
      </div>

      <div className="docs-section">
        <h2>推荐联动</h2>
        <p>
          如果你正在梳理增长链路，建议把
          <Link to="/docs/shop"> 商城配置 </Link>
          和
          <Link to="/docs/players"> 玩家管理 </Link>
          一起对照看，报表才有动作上的解释力。
        </p>
      </div>
    </DocsLayout>
  );
}
