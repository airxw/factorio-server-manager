---
type: pending-requirement
title: 待开发需求登记 — Pack 多 Variant 展示与版本号差异化显示
date: 2026-07-24
status: pending
related: docs/plans/pack-system-overhaul-plan.md, packs/terraria-vanilla/, packs/terraria-tshock/
tags: [pending, pack, variant, version-display, terraria]
---

# 待开发需求登记 — Pack 多 Variant 展示与版本号差异化显示

## 一、需求来源

来自 Pack 系统真实化重构方案(见 `docs/plans/pack-system-overhaul-plan.md` §4.2)的人类裁决:

> 1.需要,所以这里会留坑,需要在建立一个待开发需求,能显示版本类似。

## 二、需求描述

当一个 game 存在多个 variant Pack 时(如 terraria 同时有 `terraria-vanilla` 与 `terraria-tshock`),前端展示需要:

1. **variant_type 区分**:Pack 详情页 / Pack 选择页需显示 variant 类型(原版 / tshock / modded 等),用户能直观区分;
2. **版本号差异化显示**:
   - SteamCDM 分发的 Pack(如 terraria-vanilla):版本号显示为 SteamCDM buildid 或官网版本号;
   - GitHub Release 分发的 Pack(如 terraria-tshock):版本号显示为 GitHub Release tag;
   - 不同 Pack 的版本号体系不同,前端不能假设所有 Pack 版本号格式一致;
3. **多 variant 切换入口**:Pack 选择页对同一 game 的多 variant 提供切换入口,用户可比较并选择;
4. **版本号来源标注**:版本号旁边标注来源(如 "via Mojang API" / "via SteamCMD buildid" / "via GitHub Release")。

## 三、影响范围

- 前端 Pack 列表页 / Pack 详情页;
- 前端实例创建页的 Pack 选择步骤;
- 前端版本管理页;
- 后端 `/api/packs` 与 `/api/packs/:id/versions` 接口可能需要返回 `variant_type` 与 `version_source` 字段。

## 四、不阻断主路径声明

- 本需求为 Pack 系统重构的遗留待开发项,**不阻断** pack 数据校正、VersionProvider 实现、SteamCMD 流程重构等主路径工作;
- 在本需求实现前,terraria-tshock Pack 可以正常工作,只是前端展示上 variant 区分不明显;
- 本需求可在 Pack 系统重构完成后单独排期实现。

## 五、接续入口

- 实现本需求时,需先读取 `docs/plans/pack-system-overhaul-plan.md` §4.2 了解 terraria 双 Pack 决策背景;
- 需扩展 `pack-schema.ts` 的 `pack.variant` 字段为对象(含 `type` / `display_name` / `description`),或新增 `pack.variant_type` 枚举字段;
- 前端 PackCard / PackDetail 组件需根据 `variant_type` 渲染差异化标签。

## 六、交接状态

- **工程过程**:本需求由 Pack 系统重构方案 §4.2 的人类裁决衍生,已登记为独立待开发需求。
- **交接状态**:pending,等待 Pack 系统重构主路径完成后排期。
- **最终结果**:本需求文档 `docs/plans/pending-requirements.md`,作为 Pack 系统重构的遗留项追踪。
