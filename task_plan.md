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

状态：**complete（2026-04-21，commit `8c5cc46`）**

- [x] 2.1 `src/catalog.ts` —— `Catalog` / `CatalogEntry` 类型 + `loadCatalog()`（含"catalog missing"错误）
- [x] 2.2 `src/build/generate-catalog.ts` —— `generateCatalog()` 纯函数 + CLI 入口；`gray-matter` 解析 SKILL.md frontmatter（处理 parallel-implementation / ui-ux-pro-max 的跨行 description）
- [x] 2.3 `package.json`：
  - `"build"`: `"tsc && node dist/build/generate-catalog.js"` ✓
  - `"files"`: `dist/*.js` + `dist/*.d.ts` + `dist/catalog.json`（glob 排除了 `dist/build/`）✓
  - `dependencies`: `gray-matter@^4.0.3` ✓
  - 加了 `.npmignore` 作 defense-in-depth
- [x] 2.4 CI 校验 — 推迟到 Phase 7（仓库无 GitHub Actions）
- [x] 2.5 手测 `npm run build` → `✓ catalog.json: 10 workflow / 2 recommended / 4 plugins / 3 hooks`

**出口条件已达**：`dist/catalog.json` 产出正确；8 条新增 catalog 测试 + 54 既有测试全绿（62/62）；`npm pack --dry-run` 不含 `dist/build/`。

### Phase 3 — Install 函数签名扩展

状态：**complete（2026-04-21，commit `3d86bfc`）**

- [x] 3.1 `src/utils.ts` —— `InstallOpts` 类型 + `isNonInteractive()`（scope 映射在各 installer 内部就地处理，没必要抽全局 helper）
- [x] 3.2 `src/workflow.ts` —— `installWorkflow(packageRoot, opts)` ✓
- [x] 3.3 `src/skills.ts` —— `installSkills` / `installRecommendedSkills` 改签名；删除 `RECOMMENDED_DESCRIPTIONS`（由 catalog 替代）；`#29` 批量化逻辑保持不动
- [x] 3.4 `src/plugins.ts` —— `installPlugins(packageRoot, opts)` ✓
- [x] 3.5 `src/hooks.ts` —— `installHooks(packageRoot, opts)`：非交互模式下 user-scope + stale 提示都用默认值跳过（由 `--scope user` / 默认 remove 隐式表达意图）
- [x] 3.6 `tests/hooks.test.ts` —— 仅调用 `installHook`（单数），签名未变，无需更新
- [x] 补：`src/cli.ts` 既有 checkbox 菜单路径的 caller 都带上 `{ interactive: true }`，交互行为 bit-identical

**出口条件已达**：`npm test` 62/62 绿；交互路径行为无回归；非交互 code path 已就绪，等 Phase 4 的 parser 驱动。

### Phase 4 — CLI dispatcher + parser + guide + help

状态：**complete（2026-04-21）**

**4.0 — 用 codex 跑 `/test-designer`（Independent Evaluation，TDD red）**

在写任何实现代码 **之前** 做。目的：跨模型盲点覆盖 + 避免测试被 Claude 自身实现思路污染。

- [x] 4.0.1 Dispatch：codex 两次空返（exit 0 无输出）→ fallback 到 Claude sonnet subagent，产出三份失败测试（14 条）；红 baseline commit `f61497b`
- [x] 4.0.2 红 baseline：tsc 3 处错 + assertion 失败均符合"symbol 不存在"预期

**4.1–4.4 — 实现（让测试转绿）**

- [x] 4.1 `src/cli.ts` 重写——`parseArgs` / `main` / `runAll` / `runSingle` / `runLegacyMenu`
- [x] 4.2 `install` 子解析器——§3.5 + §5.2 规则逐条实现（8 条 fail-fast + nargs `--` terminator + catalog-backed filter 名校验）
- [x] 4.3 `src/help.ts` —— 从 `dist/catalog.json` 生成 help 文本（padRight/truncate 列格式）
- [x] 4.4 `src/guide.ts` —— SOP 模板 + TTY/`NO_COLOR` 分支 ANSI

**4.5 — 验证（转绿）**

- [x] 4.5 `npm test` 77/77 绿；`npm run build` 绿；`DEV=1 node dist/cli.js --help` / `guide` / `--version` 手测正常

**出口条件达成**：所有 14 条红测转绿无 skip；`install --all` 的 precheck / 分级 exit / reload 提醒在 `runAll` 里已一并落地（Phase 5 的范围收窄到"手测 + 回归"）。

### Phase 5 — install --all 的 precheck + 分级 exit + reload 提醒

状态：**complete（2026-04-21，随 Phase 4 commit `0672160` 一并落地）**

- [x] 5.1 precheck：`runAll()` 先 `which claude`，未装直接 exit 1
- [x] 5.2 逐类状态收集 + 汇总 exit code（0 / 1 / 2 per spec §5.3.1）
- [x] 5.3 成功尾部 reload 提醒（Spike #2 结论：三类都需要重启，保留）
- [x] 5.4 `install-nontty.test.ts` 三场景全绿
- [x] 5.5 手测：
  - `install workflow --cwd $TMP`：CLAUDE.md + AGENTS.md 符号链接 + reload 提醒 ✓
  - 四条 fail-fast 链路（unknown type / --all+filter / unknown skill / bare install in 非 TTY）exit 1 + 正确 stderr ✓
  - `install --all` 真跑略过（需 `claude plugins install` 的网络 + 认证；已被单测 mock 覆盖，Phase 7 端到端再验）

**出口条件达成**：spec §11 "分级退出码"行全通过（exit 0 + reload 提醒；exit 1 precheck；exit 2 partial + [OK]/[FAIL] + Retry）。

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
