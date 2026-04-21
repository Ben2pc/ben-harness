# 进度日志（progress.md）

`/clear` 后或换 session 接手时先读本文件，再读 `task_plan.md`，最后读 `findings.md`。每个 session / 每完成一个子步骤追加一条。

---

## 当前状态

- **当前 Phase**：Phase 0–3 ✅（最新 commit `3d86bfc`）；可进入 Phase 4
- **分支**：`feat/install-subcommand`（7 ahead of main）
- **Draft PR**：[#31](https://github.com/Ben2pc/auriga-cli/pull/31)（Open / Draft / Mergeable）
- **npm test**：62/62 绿
- **Install 函数签名**：4 个 installer 都吃 `InstallOpts`；非交互 code path 就位，等 CLI parser 调用
- **下一步（可直接执行的动作）**：Phase 4.0——dispatch codex 跑 `/test-designer`（TDD red，Independent Evaluation）产出 3 份失败测试：`tests/cli-parse.test.ts` / `tests/install-nontty.test.ts` / `tests/guide.test.ts`

## Session 1 — 2026-04-21（planning）

- 起点：Issue [#28](https://github.com/Ben2pc/auriga-cli/issues/28) 开放，原提案 scope 收缩
- 进展：
  - brainstorming → spec 初稿 → opus 一审（内部一致性）→ 消化 → opus 二审（Agent 视角）→ 消化 → spec 定稿
  - 顺带开 Issue [#29](https://github.com/Ben2pc/auriga-cli/issues/29)（`npx skills add` 批量化 + `-y`），与 #28 捆绑实现
  - planning-with-files 创建：`task_plan.md` / `findings.md` / `progress.md`
  - Plan 补丁：Phase 4 增加 4.0 — 用 codex 跑 `/test-designer` 做 Independent Evaluation（TDD red 在实现前）
- **Phase 0 完成**：
  - Spike #1：三场景（install / marketplace add idempotent / marketplace add error）均非交互 OK；exit 0/1 clean，无 hang 无 prompt
  - Spike #2：子 `claude -p` 自证 system prompt 已锁定；CLAUDE.md/skills/plugins 三类均需 session 重启——guide Step 4 "REQUIRED" 保持
  - spec §9 Risk #2/#3 状态回写；§10 未决项段打勾
  - findings.md 写完两条完整结论
- **main pull（2026-04-21 10:27）**：FF 到 56f6812，#29（`npx skills add` 批量化 + `npx -y`）**已合并**
  - Phase 3.3 scope 缩小：只做签名扩展，批量实现不再做
  - 新增 `tests/skills.test.ts` (121 行) — 覆盖 planner
- 阻塞：无

## 测试结果

(空；Phase 2+ 才会有 `npm test` 产出要记录)

## 关键决策快照

| 决策点 | 值 | spec 段 |
|---|---|---|
| CLI 命令风格 | 动词首 `install` | §3.2 |
| `install --all` 边界 | 含 workflow+skills+plugins+hooks，不含 recommended | §3.2 |
| 类内过滤 flag | `--skill / --plugin / --hook / --recommended-skill`，必须与匹配 `<type>` 同时出现 | §3.5 |
| `npx auriga-cli` 无参 | 沿用 checkbox（非破坏性） | §3.1 / §6 |
| 版本 | minor bump（1.x → 1.y） | §6 |
| 颜色判定 | `process.stdout.isTTY && !NO_COLOR`；不提供 CLI flag | §3.6 |
| `-y` 归属 | npx 的 flag，不是我们 CLI 的 | §3.6 |
| exit code | 分级（0 / 1 / 2） | §5.3.1 / §7 |
| Catalog 生成 | build-time 内嵌，`gray-matter` 解析 frontmatter | §5.4 |
| 规划文件位置 | 项目根（hook 约束），PR Ready 时归档到 `docs/worklog/` | 本文件 |
