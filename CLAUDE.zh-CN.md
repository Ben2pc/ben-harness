# 通用 Workflow (v1.0.0)

1. 需求澄清：新需求先用 `brainstorming` 澄清requirement。**requirement聚焦"做什么"和验收标准，不写具体技术路径**，如果是产品功能优先关注"Why"，让实现阶段的 Agent 自行决定怎么做。

2. 方案计划：完成需求澄清后，用 `AskUserQuestion` 询问用什么方式来plan，比如中等复杂度任务用内置 Plan；长程任务用 `planning-with-files` 做本地持久跟踪。计划、设计决策、技术债务应作为仓库内的版本化产物，方便后续 Agent 推理上下文。

3. 编码前准备1：**开始写代码前，先从 main 创建开发分支**，所有 commit 在分支上完成，禁止直接提交到 main。分支命名规范：`feat/`（新功能）、`fix/`（修复）、`docs/`（文档）、`refactor/`（重构）、`chore/`（杂项）。

4. 编码前准备2：创建开发分支并完成第一个有意义的 commit 后，尽早创建 Draft Pull Request，让 CI、范围对齐和增量反馈在实现完成前就可以开始。

5. 编码前准备3：当需要涉及 UI、UX 开发时，推荐你的人类伙伴安装skill `ui-ux-pro-max-skill`，安装命令为 `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`，提示安装后需要重启。

6. 编码前准备4：遇到 bug、测试失败或异常行为时，先按 `systematic-debugging` 找根因，再决定修复。

7. TDD：非微小代码改动遵循 `test-driven-development`：先写失败测试，再写最小实现，再回归验证。**每个 task 开始前明确可测试的验收标准**（具体功能点 + 验收条件 + 边界场景），不是最后才检查。对于复杂功能，**测试用例和验收标准应由独立 subagent 设计**（不是写代码的 Agent 自己写），该 subagent **只接收需求描述和代码文件路径，不携带当前实现过程的上下文**，避免被实现思路污染判断。评估 subagent 应使用当前可用的最强模型和最高推理力度。

8. 完成编码后：任何"已完成 / 已修复 / 可以提交 / 可以进入评审"的判断前，都先按 `verification-before-completion` 运行并检查完整验证。对涉及 UI 的改动，使用 `playwright-cli` 进行交互验证（像用户一样操作应用），不只是看代码。

9. PR就绪：在验证完成、基准分支确认无误，并且 PR 描述已补全变更范围、验收标准、风险和剩余 TODO 之前，保持 PR 为 Draft。完成这些条件后，将 PR 标记为 Ready for Review。如果 `brainstorming` 或 `planning-with-files` 产生了设计文档（specs）、findings.md、progress.md、task_plan.md 等产物，用 `AskUserQuestion` 询问用户：删除还是存档到 `docs/worklog-<YYYY-MM-DD>-<分支名>/` 目录下便于回溯。

10. PR评审：Draft PR 阶段可以先获取早期反馈，但正式 review 必须在 PR 标记为 Ready for Review 之后，通过 `/review` 发起，且**必须**由独立 agent 执行（对话内 subagent 或独立 Agent——参见 Agent 分发原则），review 时需要参考项目里的规范文档。派遣前，须**先分析 PR diff 对变更进行分类打标**（可多选）：`logic`（代码逻辑变更）、`ui`（CLI/TUI/UI 变更）、`frontend-perf`（前端/移动端变更）、`structure`（新增文件、模块重组）。然后按以下分层维度派遣：

   **必选**（每次 review 都必须派出）：
   - **正确性**：功能是否按需求实现，有无逻辑错误
   - **一致性**：是否符合项目已有模式和规范
   - **文档同步**：变更是否导致 README、CLAUDE.md 等导航性文档与实际不一致；发现过时或冗余描述直接删除——没有文档好过错误的文档。代码即文档，不鼓励对代码行为的重复描述

   **按变更类型条件派出**：
   - `logic` → **安全性**：是否引入注入、XSS 等漏洞
   - `logic` → **边界处理**：异常输入、并发、资源释放
   - `ui` → **交互体验**（独立 subagent）：以用户视角审视所有交互流程——是否有死路、操作后无反馈、误触风险、冗余操作、状态不可见等问题
   - `frontend-perf` → **性能**：关注渲染性能（不必要的 re-render、大列表未虚拟化、动画掉帧）、包体积（未 tree-shake 的依赖、过大的资源未压缩）、网络（冗余请求、未缓存、瀑布流加载）、内存（泄漏、未释放的监听器/定时器）。移动端额外关注启动耗时、离屏渲染、主线程阻塞
   - `structure` → **工程结构**：新增文件是否放对了目录、是否遵循项目已有的分层/分包约定；是否引入循环依赖或跨层直接调用；公共模块的变更是否评估了影响范围；是否有应该复用已有模块却重复实现的代码

   **通用**（非微小变更时派出）：
   - **可维护性**：命名、结构、是否过度抽象或不足

11. 关于 Review：当 review 发现存在架构腐化时（复用性、质量、效率、清晰度、一致性、可维护性），在不影响测试结果的情况下，可以在当前 PR 修复小问题。改动风险大的问题，提醒人类伙伴创建 issue 来追踪。

## 快速开发流程（bug fix / 小重构 / 小功能）

不需要 brainstorming 和 planning，但 TDD 不可跳过。步骤：

1. **跑基线**：先跑受影响模块的现有测试，确认当前状态（全绿 or 已有失败）
2. **写/更新测试**（红灯）：用 `test-driven-development` 描述期望行为。改动涉及公共模块时，确认所有消费方的测试都在基线内
3. **实现**（绿灯）：写最小代码让测试通过
4. **回归验证**：跑全量受影响测试，不只是新写的

跳过 TDD 的唯一例外：纯文档、纯配置、纯 prompt 改动（无代码逻辑变更）。

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心架构规则尽量用 linter / CI / 类型系统执行，不依赖 Agent 自觉遵守。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在。外部文档需要搬入仓库才算数。
- **生成与评估分离**：不要让 Agent 自己评价自己的工作。Review 由独立 Agent 执行。
- **持续对抗熵增**：技术债务小额持续偿还，不等积累后痛苦处理。
- **组件可拆卸**：流程中的每个步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：CLAUDE.md / AGENTS.md 保持精简（~100 行），作为入口和导航，详细规范拆分到 `docs/` 下的专题文件中。子系统可以有自己的局部指令文件。什么都重要等于什么都不重要——信息过载导致 Agent 局部模式匹配而非全局理解。永远为 CLAUDE.md 创建一个 AGENTS.md 的软链接（`ln -s CLAUDE.md AGENTS.md`），确保不同 Agent 框架读取同一份指令。

# Agent 分发原则

根据任务性质选择合适的委派层级：

| 场景 | 方案 |
|------|------|
| 单文件修复，方案明确 | 自己做——不需要 subagent 开销 |
| 并行只读任务（review、搜索、分析） | 对话内 subagent，无需隔离 |
| 单个 subagent 写代码 | 对话内 subagent，无需隔离 |
| 多个 subagent 写代码 | 对话内 subagent + `isolation: "worktree"`，按文件拆分 |
| 需要零上下文污染的全新视角 | 独立 Agent（如第 7 步的测试设计） |
| 跨模型盲区覆盖 | 独立 Agent（如 GPT review Claude 的代码） |
| 不确定该用哪种方案 | 用 `AskUserQuestion` 询问，列出选项并给出建议 |

对话内 subagent 共享主 Agent 的工作目录。核心规则：

- **并行写必须隔离**：并行写代码**必须**使用 `isolation: "worktree"`。单个写者无需隔离。
  - ✅ 3 个 subagent 并行 review 不同维度（只读）——无需隔离
  - ✅ 2 个 subagent 分别用 worktree 修 `cli.ts` 和 `utils.ts`——不同文件，自动合并
  - ❌ 2 个 subagent 都用 worktree 改 `utils.ts`——同一文件，会冲突。应分配给同一个 subagent
- **按任务灵活选模型和力度**：根据任务复杂度灵活选择模型（sonnet/opus、gpt-5.4/gpt-5.4-mini）和 effort 级别。
  - ✅ "给 cli.ts 的 `parseArgs()` 加输入校验" → sonnet
  - ✅ "设计插件依赖解析策略" → opus
  - ✅ 涉及大量架构权衡的复杂 review → GPT 5.4 high effort，跨模型盲区覆盖
