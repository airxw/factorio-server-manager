# 历史文档归档区

> 本目录存放已完成或已过时的历史文档，仅供回溯参考，不再维护。
>
> 归档时间：v4.0.0（2026-07-18）
> 归档原因：v4.0.0 历史包袱大清理 C9 任务，详见 `docs/v4.0.0-execution-plan.md` §十

## 归档文件清单

| 文件 | 原始路径 | 归档原因 |
|------|---------|---------|
| `3.6.0-version-management-plan.md` | `docs/3.6.0-version-management-plan.md` | v3.6.0 版本规划，已全部落地（存储清理统一治理） |
| `daemon-fetch-failed-rootcause-and-fix.md` | `docs/daemon-fetch-failed-rootcause-and-fix.md` | v3.5.x 故障排查记录，问题已在 v3.5.3 修复（Daemon WS 事件订阅缺失） |
| `deployment-experience.md` | `docs/deployment-experience.md` | 部署经验笔记，部分内容已过时（双目录约定已写入 README.md + deploy.sh 头部） |
| `instance-multi-version-plan.md` | `docs/instance-multi-version-plan.md` | 实例多版本规划，已落地为 v3.4.0 版本池功能（game_versions 表） |
| `version-roadmap-3.6.0-to-3.7.0.md` | `docs/version-roadmap-3.6.0-to-3.7.0.md` | v3.6→v3.7 路线图，已落地 |
| `v3.9.0-execution-plan.md` | `docs/v3.9.0-execution-plan.md` | v3.9.0 执行方案，已全部落地（S1-S10 安全加固 + D1-D4 灾备 + V1-V6 业务回归） |
| `long-term-version-plan-v3.6.0-to-v4.0.0.md` | `docs/long-term-version-plan-v3.6.0-to-v4.0.0.md` | v3.6.0→v4.0.0 长期版本规划，v4.0.0 完成后整体归档 |

## 保留在 docs/ 的活跃文档

以下文档仍在维护，不在归档范围：

- `docs/v4.0.0-execution-plan.md` — v4.0.0 当前执行方案
- `docs/backup-recovery.md` — 备份恢复指南（v3.9.0 D3 产出，长期有效）
- `docs/runbook.md` — 故障 Runbook（v3.9.0 D4 产出，长期有效）
- `docs/version-history.md` — 历史版本注释归档（v3.9.0 L1 产出，长期有效）
- `docs/production-deployment.md` — 生产部署指南
- `docs/pack-development-guide.md` — Pack 开发指南

## 归档原则

1. 已完成版本规划的执行方案文档（计划落地后归档）
2. 已修复故障的排查记录（修复验证后归档）
3. 内容已过时或被新文档替代的笔记
4. 长期版本规划在最后一个版本完成后整体归档

归档不删除，仅移动到本目录，便于后续回溯历史决策与上下文。
