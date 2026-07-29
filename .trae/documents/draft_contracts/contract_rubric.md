# 三层契约合规与验收判据 (Rubric)

## 1. 数据契约校验 (Schema)
- [ ] `GlobalAsset` Schema 是否定义了必填项 (id, type, name, is_active)？
- [ ] `InstanceAsset` Schema 是否定义了对 `GlobalAsset` 的继承关系 (global_asset_id 字段) 与覆盖字段 (override_*)？
- [ ] Schema 是否全部符合 JSON Schema draft-07 规范？

## 2. 接口契约校验 (Interface)
- [ ] 接口是否声明了入参类型和返回值类型？
- [ ] 接口是否通过 `@throws` 或明确声明抛出与 `error_codes.json` 相符的错误？
- [ ] 接口是否覆盖了 B2B2C 商业模式的核心逻辑 (合并获取、覆盖、自定义创建、安全执行)？

## 3. 配置契约校验 (Config)
- [ ] `CommercialSystemConfig` 是否为所有数值型字段定义了 `minimum` 和 `maximum`？
- [ ] `CommercialSystemConfig` 是否为所有字段定义了 `default` 默认值？

## 4. 异常与错误码校验
- [ ] `error_codes.json` 中是否统一声明了各模块的错误码（HTTP状态码及信息）？
- [ ] 错误码是否能完全映射到接口存根抛出的异常集合中？