# Test2 Browser Check

- 时间：`2026-07-29T14:26:11Z` - `2026-07-29T14:27:30Z`
- 目标站点：`https://gsp.ecsrz.com:3001`
- 浏览器入口：integrated browser

## 入口与健康检查

1. `curl -k -I https://localhost:3001/docs` 返回 `HTTP/1.1 200 OK`
2. `curl -I http://localhost:3000/docs` 返回 `HTTP/1.1 301 Moved Permanently`
3. `curl -k https://localhost:3001/api/health` 返回 `{"status":"ok"}`

## 页面核对

### `/docs?ts=1785335200`

- 标题：`文档 - GSP - GameServer Panel`
- 快照确认可见入口：
  - `阅读配置文档 →`
  - `查看 Pack 列表 →`
  - `商城配置指南 →`
  - `玩家管理文档 →`
  - `数据看板指南 →`
  - `查看节点文档 →`
- 文案核对：
  - Pack 卡片已显示 `9 款官方 Pack 安装与使用`
  - 新增 `Daemon 节点` 卡片

### `/docs/config?ts=1785335201`

- 标题：`配置指南 - GSP - GameServer Panel`
- H1：`部署拓扑与核心配置`
- 快照可见章节：`访问入口` / `数据库配置` / `SSL 与域名` / `后台设置入口` / `排错顺序`
- 结果：未出现“抱歉，您访问的页面不存在”

### `/docs/packs?ts=1785335202`

- 标题：`游戏 Pack - GSP - GameServer Panel`
- H1：`Pack 安装与运维说明`
- 快照可见章节：`当前内置 Pack` / `标准上线流程` / `什么时候要自定义 Pack` / `升级建议`
- 结果：未出现 404

### `/docs/shop?ts=1785335203`

- 标题：`商城配置 - GSP - GameServer Panel`
- H1：`VIP、商品与 CDK 的运营闭环`
- 快照可见章节：`功能模块` / `推荐配置顺序` / `后台入口建议` / `常见落地方式`
- 结果：未出现 404

### `/docs/players?ts=1785335204`

- 标题：`玩家管理 - GSP - GameServer Panel`
- H1：`从绑定到互动的玩家链路`
- 快照可见章节：`玩家管理包含什么` / `推荐的管理顺序` / `常见入口` / `与商城和报表的关系`
- 结果：未出现 404

### `/docs/reports?ts=1785335205`

- 标题：`数据看板 - GSP - GameServer Panel`
- H1：`从流水到系统健康的观测视角`
- 快照可见章节：`三类常用看板` / `后台入口` / `怎么读这些数据` / `推荐联动`
- 结果：未出现 404

### `/docs/daemon?ts=1785335206`

- 标题：`Daemon 节点 - GSP - GameServer Panel`
- H1：`节点部署与连接检查`
- 快照可见章节：`一条完整链路` / `关键约定` / `部署后先做这几个检查` / `和哪些页面配合使用`
- 结果：未出现 404

## 结论

Test2 PASS。线上文档首页入口和 6 条二级文档路由均可访问，已从“点开即 404”修复为真实页面。
