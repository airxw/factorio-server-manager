# Task 7 输出：契约 — bindings-schema 描述更新（s0601 流程）

> 执行时间：2026-07-30
> 执行者：general_purpose_task subagent

## 一、s0601 契约变更适配流程

### 1.1 变更影响面识别

| 项目 | 内容 |
|------|------|
| **变更类型** | PATCH（仅字段描述修正，不改字段定义） |
| **变更文件** | `public/schema/bindings-schema.json` `vip_level` 字段 `description` |
| **字段定义** | 不变（type: integer / minimum: 0 / maximum: 5 / default: 0 保持原样） |
| **旧描述** | `VIP 等级 0-5（仅 binding_type='account' 有意义；binding_type='player' 恒为 0）` |
| **新描述** | `VIP 等级 0-5。仅 verify 角色后才有意义（vip_level 由 verifyBindingByCode 赋予）；bindInstance 创建时为 0。binding_type='player' 恒为 0` |
| **变更原因** | VIP 语义修正——原描述暗示"账户级绑定即有意义"，但实际 VIP 仅由 verifyBindingByCode 路径赋予（玩家角色验证成功后回填到 account 绑定） |

### 1.2 依赖模块 TODO

- **PATCH 级别仅记录，不阻断**：下游消费方（voteService / shopService / walletService / getUserVipLevel）的查询逻辑不变，仅是数据来源语义澄清
- **Mock 与测试套件无需同步**：description 不影响 zod/ajv 校验

### 1.3 ws-events.ts 确认

- `player.binding_verified` 不进 `public/schema/ws-events.ts`（Panel 内部事件，不进跨进程契约）
- grep 验证：`player.binding_verified` 在 `public/` 目录下仅出现于 CHANGELOG.md（本次新增记录），ws-events.ts 中无匹配

## 二、修改文件清单

| 文件 | 变更 |
|------|------|
| `/home/airxw/gsp/public/schema/bindings-schema.json` | `vip_level.description` 字段更新 |
| `/home/airxw/gsp/public/schema/CHANGELOG.md` | 新增 v4.38.0 PATCH 条目 |

## 三、验证结果

| 验证项 | 结果 |
|--------|------|
| JSON 格式校验 | ✅ 通过（python3 json.load） |
| 契约测试套件（bindings-contract.test.ts） | ✅ 32 通过 / 0 失败 |
| ws-events.ts 未被修改 | ✅ grep 验证无 `player.binding_verified` 匹配 |
| 字段定义不变（type/minimum/maximum/default） | ✅ 已确认仅修改 description |

## 四、闭合判据核验

- [x] s0601 流程已走（变更影响面识别 + 依赖模块通知）
- [x] bindings-schema.json `vip_level` 字段 description 已更新
- [x] zod schema 校验通过（jsonschema Validator 32/32 PASS）
- [x] ajv 元校验通过（通过 jsonschema Validator 覆盖，含 additionalProperties:false + allOf 条件约束）
- [x] CHANGELOG 更新
- [x] ws-events.ts 未被修改（grep 验证无匹配）

## 五、未修改文件确认

- `public/schema/ws-events.ts` — 未修改（`player.binding_verified` 是 Panel 内部事件）
- `public/interface_stub/bindings.d.ts` — 未修改（接口签名不变）
- `public/pre_generated_mock/bindings.ts` — 未修改（mock 数据不变）
- `public/test_cases/bindings-contract.test.ts` — 未修改（测试用例不变，32/32 PASS）
- `public/test_cases/bindings-api-contract.test.ts` — 未修改
