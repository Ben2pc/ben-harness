# 任务规划：`npx auriga-cli install` 非交互子命令

## 目标

实现 Issue [#28](https://github.com/Ben2pc/auriga-cli/issues/28) + [#29](https://github.com/Ben2pc/auriga-cli/issues/29)。一句话：让 Agent 在 `claude -p` 这类非 TTY 会话里，通过 `npx -y auriga-cli guide` 单一入口，自主装好整个 auriga harness（workflow / skills / plugins / hooks）。

**权威依据**：`docs/specs/2026-04-21-install-subcommand-design.md` —— 已完成 brainstorming + 两轮 opus 独立评审 + 消化反馈。实施过程里所有"怎么做"的分歧都回去查 spec；spec 没说的再回来补。

## 关键前置（Phase 0 不完成不拉分支）

§10 的两条 spike 必须在分支开 Draft PR 前跑完，结果回写到 spec §9 Risk 与 §3.6 guide Step 4 定稿。spike 结论直接影响后续 Phase 的实现。

---

## 阶段清单

### Phase 0 — Spike（pre-branch，在 main 上跑）

状态：**complete（2026-04-21）**

- [x] S0.1 — Spike #1：`claude plugins install` 非交互 OK（三场景干净，无 hang 无 prompt）
- [x] S0.2 — Spike #2：三类均需 session 重启（**分支 (b) 命中**；子 session 自证 system prompt 已锁定）
- [x] S0.3 — 回写 spec §9 Risk #2/#3 + §10 打勾；guide Step 4 "REQUIRED" 保持

**出口条件已达**：findings.md 有两条 spike 的完整结论 + 对 spec 影响；spec §10 无未决项。

### Phase 1 — 分支 + Draft PR

状态：**complete（2026-04-21）**

- [x] 1.1 从 main 切 `feat/install-subcommand`（commit `1a2b26b`）
- [x] 1.2 首批 commit：spec (`1a2b26b`) + 规划三件套 + .gitignore (`d7233af`)
- [x] 1.3 `gh pr create --draft` → **PR #31** https://github.com/Ben2pc/auriga-cli/pull/31
- [x] 1.4 CI — **仓库当前没有 GitHub Actions 配置**；spec §5.4/§11 里"CI 里加 `test -f dist/catalog.json`"的那条在 Phase 7 决定是否加 CI 或延期到另一 issue

**出口条件已达**：Draft PR URL 可访问；无 CI 即无"跑绿"概念，以"已知无 CI 配置"结案。

### Phase 2 — Catalog 基建（底座，先于 CLI）

状态：**pending**

- [ ] 2.1 `src/catalog.ts` —— 类型定义 + `loadCatalog()` 读取工具
- [ ] 2.2 `src/build/generate-catalog.ts` —— build 脚本，用 `gray-matter` 解析 SKILL.md frontmatter
- [ ] 2.3 `package.json`：
  - `"build"`: `"tsc && node dist/build/generate-catalog.js"`
  - `"files"`: 显式列表（不含 `dist/build/`）
  - `dependencies`: 加 `gray-matter`
- [ ] 2.4 CI 在 build 后跑 `test -f dist/catalog.json`
- [ ] 2.5 手测 `npm run build`，验 `dist/catalog.json` 结构符合 spec §5.4

**出口条件**：`dist/catalog.json` 可复现生成；含 12 个 skill（10 workflow + 2 recommended）+ 4 plugins + 3 hooks。

### Phase 3 — Install 函数签名扩展

状态：**pending**

- [ ] 3.1 `src/utils.ts` —— `InstallOpts` 类型 + `isNonInteractive()` + scope 词汇映射 `mapScope(s)`
- [ ] 3.2 `src/workflow.ts` —— `installWorkflow(packageRoot, opts)`；opts 缺省保持现有 prompt
- [ ] 3.3 `src/skills.ts` —— `installSkills` / `installRecommendedSkills` 改签名（`#29 批量化 + npx -y` 已在 main 的 commit 56f6812 落地，**不再重复做**）：
  - 新签名吃 `opts: InstallOpts`；`interactive=false` 时跳过 scope/checkbox 交互，直接用 `opts.scope` + `opts.selected`
  - 复用 `planSkillInstallCommands`（已导出为纯函数）
  - 删除 `RECOMMENDED_DESCRIPTIONS` map（由 catalog 替代）
  - `tests/skills.test.ts` 已覆盖 planner，只需新增"非交互路径"相关用例
- [ ] 3.4 `src/plugins.ts` —— `installPlugins(packageRoot, opts)`
- [ ] 3.5 `src/hooks.ts` —— `installHooks(packageRoot, opts)`
- [ ] 3.6 更新 `tests/hooks.test.ts` 中的 caller 签名

**出口条件**：`npm test` 绿；交互路径（现有 CLI）行为无回归。

### Phase 4 — CLI dispatcher + parser + guide + help

状态：**pending**

**4.0 — 用 codex 跑 `/test-designer`（Independent Evaluation，TDD red）**

在写任何实现代码 **之前** 做。目的：跨模型盲点覆盖 + 避免测试被 Claude 自身实现思路污染。

- [ ] 4.0.1 `codex-agent` dispatch：
  - **输入**：spec `docs/specs/2026-04-21-install-subcommand-design.md` 的 §3.2 / §3.5 / §3.6 / §5.2 / §5.3.1 / §7 / §11（仅需求 + 契约 + 验收矩阵；**不给**实现思路）
  - **要求**：用 `test-designer` skill；effort high；返回可直接保存并运行的失败测试
  - **作用域**：
    - `tests/cli-parse.test.ts`：parse 矩阵（合法形式 + fail-fast 规则 8 条 + nargs terminator）
    - `tests/install-nontty.test.ts`：非交互冒烟 + 分级 exit（mock 三种状况：precheck 失败 / 部分成功 / 全成功）
    - `tests/guide.test.ts`：SOP 输出快照 + TTY/NO_COLOR 分支 + 带参 fail-fast
  - **输出契约**：三份测试文件 + 每份顶部一段"覆盖了 spec 哪些段号"的注释；不产出实现代码
- [ ] 4.0.2 主 Agent 把 codex 产出的三份文件落盘；跑 `npm test` 预期**全部失败**（红）——记录一次 baseline，确认测试确实在测东西

**4.1–4.4 — 实现（让测试转绿）**

- [ ] 4.1 `src/cli.ts` 重写——顶层 dispatch (`guide` / `install` / `--help` / `--version` / 无参)
- [ ] 4.2 `install` 子解析器——按 spec §3.5 + §5.2 的规则逐条实现 fail-fast
- [ ] 4.3 `src/help.ts` —— 从 `dist/catalog.json` 生成 help 文本
- [ ] 4.4 `src/guide.ts` —— SOP 模板，TTY/`NO_COLOR` 自动判定

**4.5 — 验证（转绿）**

- [ ] 4.5 `npm test` 全绿；对照 4.0.2 的红→绿 diff，确认每条失败都因实现而通过，没靠跳过

**出口条件**：`DEV=1 node dist/cli.js guide` 打印 spec §3.6 的 SOP；`DEV=1 node dist/cli.js install`（管道）exit 1 + 预期错误串；`DEV=1 node dist/cli.js --help` 输出目录；4.0.1 codex 产出的测试全部转绿且无 skip。

### Phase 5 — install --all 的 precheck + 分级 exit + reload 提醒

状态：**pending**

- [ ] 5.1 precheck 阶段：`which claude` / `which git` / `fetchContentRoot()` 预拉取
- [ ] 5.2 逐类状态收集；汇总 exit code（0 / 1 / 2 per spec §5.3.1）
- [ ] 5.3 成功尾部输出 reload 提醒（若 Spike #2 结论是 (a)"立即生效"，此条降级或删除）
- [ ] 5.4 回归 `install-nontty.test.ts`：mock 三种状况（precheck 失败 / 部分成功 / 全成功）
- [ ] 5.5 手测：真跑一遍 `DEV=1 node dist/cli.js install --all --cwd /tmp/smoke-$(date +%s)`

**出口条件**：spec §11 "分级退出码"三行验收项通过。

### Phase 6 — README + CLAUDE.md 更新

状态：**pending**

- [ ] 6.1 README 开头加 "Agent bootstrap" 段：`npx -y auriga-cli guide`（说明 `-y` 是 npx 的 flag）
- [ ] 6.2 根 `CLAUDE.md` 加"如何重新安装 harness"反向指针段（短，指向 `auriga-cli guide`）
- [ ] 6.3 `CLAUDE.zh-CN.md` / `README.zh-CN.md` 同步改动

**出口条件**：两语言文档 diff 对称；无"非交互用法"在任一语言版本里缺失。

### Phase 7 — Deep review + Ready

状态：**pending**

- [ ] 7.1 本地端到端 smoke：空目录跑 `npx -y auriga-cli guide`；按 SOP 跑 `install --all`
- [ ] 7.2 在 `claude -p --worktree` 非交互 session 里实测 bootstrap 流程（验证 spike 结论仍成立）
- [ ] 7.3 dispatch `deep-review` skill（PR Ready 前必须走一次）
- [ ] 7.4 处理 blocking findings（现 PR 内修 or 延期到新 issue，按 CLAUDE.md step 12）
- [ ] 7.5 `package.json` 版本号 bump minor
- [ ] 7.6 规划文件 + 活 spec 归档到 `docs/worklog/worklog-2026-04-21-feat-install-subcommand/`（让 `docs/specs/` 干净以过 pr-ready-guard）
- [ ] 7.7 PR 切 Ready for Review；PR body 更新（scope / acceptance / risks / TODOs）

**出口条件**：PR Ready；deep-review blocking findings 清空；CI 绿。

---

## 错误记录

| 时间 | 错误 | 尝试 | 解决 |
|---|---|---|---|
| (空) | | | |

## 本次会话笔记

- 2026-04-21：完成 brainstorming + 两轮 opus 评审 + spec 定稿 + 开 #29；Phase 0 待启动

## 参考

- Spec：`docs/specs/2026-04-21-install-subcommand-design.md`
- Issue：[#28](https://github.com/Ben2pc/auriga-cli/issues/28)、[#29](https://github.com/Ben2pc/auriga-cli/issues/29)
- CLAUDE.md 工作流：参考 `/Users/pangcheng/Workspace/auriga-cli/CLAUDE.md`
