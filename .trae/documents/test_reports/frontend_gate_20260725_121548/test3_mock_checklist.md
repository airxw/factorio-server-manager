验证对象：前端公开页风格统一（/、/home、/player）+ BUILD 序列落盘

- [x] /home 已统一到 / 的 LandingV6（路由层复用）
- [x] LandingV6 页脚版权行追加 BUILD（右侧同一行）
- [x] LandingV6 的 Logo（nav 与 footer）可点击回到 / 并滚动到顶
- [x] /player 页脚版权行追加 BUILD（右侧同一行）
- [x] /player 页脚 Brand 区可点击回到 / 并滚动到顶
- [x] BUILD_ID 已集中到 panel/frontend/src/buildInfo.ts，并被 Login/Layout/Demo/Identity/LandingV6/PlayerHome 复用
- [x] MSW Mock 补齐 /api/cdk/lookup 与 /api/cdk/redeem，修复单测环境的未处理请求
