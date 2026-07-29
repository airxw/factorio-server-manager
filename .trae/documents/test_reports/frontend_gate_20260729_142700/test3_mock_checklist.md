# Test3 Mock Checklist

- 时间：`2026-07-29T14:27:55Z`
- 目标改动：公开文档页 `/docs/*`

## 依赖排除检查

1. 对以下文件执行依赖扫描：
   - `panel/frontend/src/pages/Docs.tsx`
   - `panel/frontend/src/pages/DocsConfig.tsx`
   - `panel/frontend/src/pages/DocsPacks.tsx`
   - `panel/frontend/src/pages/DocsShop.tsx`
   - `panel/frontend/src/pages/DocsPlayers.tsx`
   - `panel/frontend/src/pages/DocsReports.tsx`
   - `panel/frontend/src/pages/DocsDaemon.tsx`
   - `panel/frontend/src/pages/DocsLayout.tsx`
2. 检查关键词：`fetch` / `api.` / `useQuery` / `useAuth` / `request(` / `client`
3. 结果：无命中

## Mock 回归判定

- 本次页面全部为静态公开文档页
- 不发起 API 请求
- 不消费鉴权态
- 不依赖 MSW/Mock 数据返回
- 因此不存在“真实接口未就位，需要 Mock 替身兜底”的交互路径

## 回归结论

将 Test3 记为 PASS，理由不是“跳过”，而是“本次改动无 Mock 交互面，已完成依赖排除检查”。

若后续这些文档页引入：

- 动态目录
- 文档搜索
- 推荐内容 API
- 登录态个性化内容

则必须重新补做 Mock 回归入口。
