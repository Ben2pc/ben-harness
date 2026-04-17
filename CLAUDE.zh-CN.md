# 通用 Workflow (v1.3.0)

1. 需求澄清：新需求先用 `brainstorming` 澄清requirement。**requirement聚焦"做什么"和验收标准，不写具体技术路径**，如果是产品功能优先关注"Why"，让实现阶段的 Agent 自行决定怎么做。

2. 方案计划：完成需求澄清后，用 `AskUserQuestion` 询问用什么方式来plan，比如中等复杂度任务用内置 Plan；长程任务用 `planning-with-files` 做本地持久跟踪。计划、设计决策、技术债务应作为仓库内的版本化产物，方便后续 Agent 推理上下文。

3. 编码前准备1：**开始写代码前，先从 main 创建开发分支**，所有 commit 在分支上完成，禁止直接提交到 main。分支命名规范：`feat/`（新功能）、`fix/`（修复）、`docs/`（文档）、`refactor/`（重构）、`chore/`（杂项）。

4. 编码前准备2：创建开发分支并完成第一个有意义的 commit 后，尽早创建 Draft Pull Request，让 CI、范围对齐和增量反馈在实现完成前就可以开始。

5. 编码前准备3：当需要涉及 UI、UX 开发时，推荐你的人类伙伴安装skill `ui-ux-pro-max-skill`，安装命令为 `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`，提示安装后需要重启。

6. 编码前准备4：遇到 bug、测试失败或异常行为时，先按 `systematic-debugging` 找根因，再决定修复。

7. TDD：非微小代码改动遵循 `test-driven-development`：先写失败测试，再写最小实现，再回归验证。**每个 task 开始前明确可测试的验收标准**（具体功能点 + 验收条件 + 边界场景），不是最后才检查。对于复杂功能，调用 `test-designer` skill——它内置 **Independent Evaluation**，派遣零上下文的 agent，仅接收需求描述和代码路径（不包含实现方案），以最高推理力度返回可执行的失败测试。

8. 并行实现：绿灯阶段**满足以下任一条件**时才调用 `parallel-implementation`：(a) 跨多个独立模块的 **0→1 新建**——规划分层并行切片；(b) 改动涉及 **≥3 个模块**——用 `AskUserQuestion` 让用户确认后再派遣；(c) 改动涉及 **≥5 个文件且每个文件 diff >50 行**——主动建议并行。skill 返回分片计划（文件归属、依赖关系、每片的输出格式契约）；根据计划用并行 `Agent` 调用 + `isolation: "worktree"` 派遣。低于这些门槛就串行写——多 agent 的开销不值得。

9. 完成编码后：任何"已完成 / 已修复 / 可以提交 / 可以进入评审"的判断前，都先按 `verification-before-completion` 运行并检查完整验证。对涉及 UI 的改动，使用 `playwright-cli` 进行交互验证（像用户一样操作应用），不只是看代码。

10. PR就绪：在验证完成、基准分支确认无误，并且 PR 描述已补全变更范围、验收标准、风险和剩余 TODO 之前，保持 PR 为 Draft。完成这些条件后，将 PR 标记为 Ready for Review。如果 `brainstorming` 或 `planning-with-files` 产生了设计文档（specs）、findings.md、progress.md、task_plan.md 等产物，用 `AskUserQuestion` 询问用户：删除还是存档到 `docs/worklog-<YYYY-MM-DD>-<分支名>/` 目录下便于回溯。

11. PR评审：Draft PR 阶段可以先获取早期反馈。PR 标记为 Ready for Review 后，正式 review 必须通过 `deep-review` skill 发起（`/deep-review` 或"跑一次 deep review"）。该 skill 内置 **Independent Evaluation** 和完整的分派矩阵——必选三维度（正确性、一致性、文档同步），按变更类型条件派出（`logic` → 安全性 + 边界处理，`ui` → 交互体验，`frontend-perf` → 性能，`structure` → 工程结构），以及非微小变更时的通用可维护性。`/review`（插件 slash command）保留作为轻量 fallback。

12. 关于 Review：当 review 发现存在架构腐化时（复用性、质量、效率、清晰度、一致性、可维护性），在不影响测试结果的情况下，可以在当前 PR 修复小问题。改动风险大的问题，提醒人类伙伴创建 issue 来追踪。

## 快速开发流程（bug fix / 小重构 / 小功能）

这个快捷流程只跳过 brainstorming 和 planning；分支、Draft PR、TDD、验证和 review 规则仍然适用。步骤：

1. **跑基线**：先跑受影响模块的现有测试，确认当前状态（全绿 or 已有失败）
2. **写/更新测试**（红灯）：用 `test-driven-development` 描述期望行为。改动涉及公共模块时，确认所有消费方的测试都在基线内
3. **实现**（绿灯）：写最小代码让测试通过
4. **回归验证**：跑全量受影响测试，不只是新写的

跳过 TDD 的唯一例外：纯文档、纯配置、纯 prompt 改动（无代码逻辑变更）。

## 文档规范

仓库文档统一放 `docs/` 下，按用途分目录，让 Agent、`pr-ready-guard` hook、人工 reviewer 对"文档该放哪、从哪找"有一致认知。

| 目录 | 用途 | 生命周期 |
|---|---|---|
| `docs/worklog-<YYYY-MM-DD>-<branch-name>/` | 已归档的 session-ephemeral planning 产物（`findings.md`、`progress.md`、`task_plan.md`、设计 spec）。在 step 10 PR ready 时归档。 | PR merge 后永久保留 |
| `docs/rules/` | 编码规范、review checklist、命名 / 风格约定 | 长期维护 |
| `docs/architecture/` | 长期设计文档（模块布局、数据流、组件职责）。由初始的 `auriga-cli-design.md` 起头。 | 长期 |
| `docs/` 其他 | 按需新增：`runbooks/`（运维流程）、`adr/`（架构决策记录）、`onboarding/` 等。一类文档一个目录，不混放 | 因类而异 |

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心架构规则尽量用 linter / CI / 类型系统执行，不依赖 Agent 自觉遵守。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在。外部文档需要搬入仓库才算数。
- **Independent Evaluation（独立评估）**：复杂功能的测试设计和正式 review 必须由独立 agent 执行，不要让 Agent 评估自己的工作。
- **持续对抗熵增**：技术债务小额持续偿还，不等积累后痛苦处理。
- **组件可拆卸**：流程中的每个步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：CLAUDE.md / AGENTS.md 保持精简（~100 行），作为入口和导航，详细规范拆分到 `docs/` 下的专题文件中。子系统可以有自己的局部指令文件。什么都重要等于什么都不重要——信息过载导致 Agent 局部模式匹配而非全局理解。永远为 CLAUDE.md 创建一个 AGENTS.md 的软链接（`ln -s CLAUDE.md AGENTS.md`），确保不同 Agent 框架读取同一份指令。
- **自动化阶梯（先对话内用，沉淀后再自动化）**：Subagent 的调用有 5 层，从灵活到锁死：对话内 subagent → `.claude/agents/` → CLAUDE.md 政策 → Skill → Hook。**每往上一级，就多锁住一个假设。** 同一派遣模式在真实场景稳定复现 3 次以上，再升级上一级。提前固化会导致：`.claude/agents/` 文件堆积、hook 在错误场景触发、skill 固化了过时的分派结构。不确定时，留在阶梯下层。

# Agent 分发原则

根据任务性质选择合适的委派层级：

| 场景 | 方案 |
|------|------|
| 单文件修复，方案明确 | 自己做——不需要 subagent 开销 |
| 并行只读任务（review、搜索、分析） | 对话内 subagent，无需隔离 |
| 单个 subagent 写代码 | 对话内 subagent，无需隔离 |
| 多个 subagent 写代码 | 调用 `parallel-implementation` skill 产出分片计划，再按计划用 `isolation: "worktree"` 派遣 |
| 需要零上下文污染的全新视角 | 独立 Agent（如第 7 步的测试设计） |
| 跨模型盲区覆盖 | 独立 Agent（如 GPT review Claude 的代码） |
| 不确定该用哪种方案 | 用 `AskUserQuestion` 询问，列出选项并给出建议 |

对话内 subagent 共享主 Agent 的工作目录。核心规则：

- **并行写必须隔离**：并行写代码**必须**使用 `isolation: "worktree"`；单个写者无需隔离。切片决策（怎么切、在哪会撞、什么时候不派）交给 `parallel-implementation` skill——它内置了文件归属、碰撞合并、大小过滤等过去写在这里的规则。
- **按任务灵活选模型和力度**：根据任务复杂度灵活选择模型（sonnet/opus、gpt-5.4/gpt-5.4-mini）和 effort 级别。
  - ✅ "给 cli.ts 的 `parseArgs()` 加输入校验" → sonnet
  - ✅ "设计插件依赖解析策略" → opus
  - ✅ 涉及大量架构权衡的复杂 review → GPT 5.4 high effort，跨模型盲区覆盖
- **始终显式指定输出格式**（shape + scope/length）：不给 subagent 定格式契约，它会默认 dump 冗长上下文回来，抵消派遣的 context 收益。规则本身只约束"必须显式"——具体格式按任务选，例如 "summary ≤300 字"、"punch list，每项一行"、"diff + 每处一行理由"、"结构化 JSON `{...}`"、"一段话判断 + 一行依据"。不穷举格式清单，按任务选合适的。
- **subagent 无法交换中间状态**：Claude Code 没有 agent-to-agent 通道。如果任务需要 subagent 之间在执行途中协调，要么 serialize（A→主 Agent 转发给 B），要么合并成单线任务。注意：sequential handoff（A→主→B）不算互通，是正常流水线。
