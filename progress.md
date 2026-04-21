# 进度日志（progress.md）

`/clear` 后或换 session 接手时先读本文件，再读 `task_plan.md`，最后读 `findings.md`。每个 session / 每完成一个子步骤追加一条。

---

## 当前状态

- **当前 Phase**：Phase 0–5 ✅；可进入 Phase 6
- **分支**：`feat/install-subcommand`（最新 commit `0672160`，已 push）
- **Draft PR**：[#31](https://github.com/Ben2pc/auriga-cli/pull/31)（Open / Draft / Mergeable）
- **npm test**：77/77 绿（14 条新测全通过，含 parser / install-nontty / guide）
- **CLI 实现就位**：`src/cli.ts`（parseArgs + main + runAll/runSingle/runLegacyMenu）、`src/guide.ts`、`src/help.ts`
- **Phase 5 随 Phase 4 一并落地**（precheck + 分级 exit + reload 提醒都在 `runAll`）；四条 fail-fast 手测通过
- **下一步**：Phase 6（README 开头 + 根 `CLAUDE.md` 反向指针段，中英双语对称）；Phase 7 deep-review + Ready

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

- 2026-04-21 Phase 4：`npm test` 77/77 绿
  - Phase 4.0 red baseline：14 条新测全失败（符合预期）
  - Phase 4.1–4.4 实现（`src/cli.ts` / `src/guide.ts` / `src/help.ts`）后全绿
  - 期间引入 `--experimental-test-module-mocks` flag（Node test runner 模块 mock）

## Session 2 — 2026-04-21（Phase 4 实现）

- Phase 4.0：codex dispatch 受阻（两次 exit 0 无输出）；fallback 到 Claude sonnet subagent 完成，产出 14 条 red 测
- Phase 4.1–4.4：主 Agent 直接写 `src/cli.ts`（parser + main + runAll/runSingle + legacy menu）/ `src/guide.ts` / `src/help.ts`
- Phase 4.5：调整 3 处转绿
  - parser：`--` 后出现位置参数 → 按 §3.5 规则 1 抛 "install takes one <type> at a time"
  - parser：新增 catalog-backed filter 名校验（sync，读 `dist/catalog.json`）
  - CLI：TTY-only deps（`@inquirer/prompts`、`printBanner`、`withEsc`）改为动态 import，避免在 mocked utils 场景下解析失败
  - `package.json` test 脚本加 `--experimental-test-module-mocks`；`require("../package.json")` 改为通过 `getPackageRootSync` 解析（支持 dist/ 与 dist-test/src/ 两套运行路径）

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
