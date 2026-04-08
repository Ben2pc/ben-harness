# 通用 Workflow (v0.1.0)

1. 需求澄清：新需求先用 `brainstorming` 澄清requirement。**requirement聚焦"做什么"和验收标准，不写具体技术路径**，如果是产品功能优先关注"Why"，让实现阶段的 Agent 自行决定怎么做。

2. 方案计划：完成需求澄清后，用 `AskUserQuestion` 询问用什么方式来plan，比如中等复杂度任务用内置 Plan；长程任务用 `planning-with-files` 做本地持久跟踪。计划、设计决策、技术债务应作为仓库内的版本化产物，方便后续 Agent 推理上下文。

3. 编码前准备1：**开始写代码前，先从 main 创建开发分支**，所有 commit 在分支上完成，禁止直接提交到 main。分支命名规范：`feat/`（新功能）、`fix/`（修复）、`docs/`（文档）、`refactor/`（重构）、`chore/`（杂项）。

4. 编码前准备2：当需要涉及 UI、UX 开发时，推荐你的人类伙伴安装skill `ui-ux-pro-max-skill`，安装命令为 `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`，提示安装后需要重启。

5. 编码前准备3：遇到 bug、测试失败或异常行为时，先按 `systematic-debugging` 找根因，再决定修复。

6. TDD：非微小代码改动遵循 `test-driven-development`：先写失败测试，再写最小实现，再回归验证。**每个 task 开始前明确可测试的验收标准**（具体功能点 + 验收条件 + 边界场景），不是最后才检查。对于复杂功能，**测试用例和验收标准应由独立 subagent 设计**（不是写代码的 Agent 自己写），该 subagent **只接收需求描述和代码文件路径，不携带当前实现过程的上下文**，避免被实现思路污染判断。评估 subagent 应使用当前可用的最强模型和最高推理力度。

## 快速开发流程（bug fix / 小重构 / 小功能）

不需要 brainstorming 和 planning，但 TDD 不可跳过。步骤：

1. **跑基线**：先跑受影响模块的现有测试，确认当前状态（全绿 or 已有失败）
2. **写/更新测试**（红灯）：用 `test-driven-development` 描述期望行为。改动涉及公共模块时，确认所有消费方的测试都在基线内
3. **实现**（绿灯）：写最小代码让测试通过
4. **回归验证**：跑全量受影响测试，不只是新写的

跳过 TDD 的唯一例外：纯文档、纯配置、纯 prompt 改动（无代码逻辑变更）。

7. 完成编码后：任何"已完成 / 已修复 / 可以提交"的判断前，都先按 `verification-before-completion` 运行并检查完整验证。对涉及 UI 的改动，使用 `playwright-cli` 进行交互验证（像用户一样操作应用），不只是看代码。

8. 完成需求后：开发分支工作后，**确保**相关测试都已执行并通过，确认基准分支，提交 Pull Request。如果 `brainstorming` 或 `planning-with-files` 产生了设计文档（specs）、findings.md、progress.md、task_plan.md 等产物，用 `AskUserQuestion` 询问用户：删除还是存档到 `docs/worklog-<YYYY-MM-DD>-<分支名>/` 目录下便于回溯。

9. 提交PR后：提醒人类伙伴使用 `/review` 进行 review，且**必须**要派 subagent 来执行，针对不同的纬度派遣多个 subagent 来 review，review时需要参考项目里的规范文档。Review subagent 使用以下结构化评分维度（按模型短板加权）：
   1. **正确性**：功能是否按需求实现，有无逻辑错误
   2. **安全性**（高权重）：是否引入注入、XSS 等漏洞
   3. **一致性**（高权重）：是否符合项目已有模式和规范
   4. **边界处理**（高权重）：异常输入、并发、资源释放
   5. **可维护性**：命名、结构、是否过度抽象或不足
   6. **交互体验**（涉及 CLI/TUI/UI 时必须）：以用户视角审视所有交互流程——是否有死路、操作后无反馈、误触风险、冗余操作、状态不可见等问题。独立派一个 subagent 专门做交互体验 review
   7. **性能**（涉及前端/移动端时高权重）：关注渲染性能（不必要的 re-render、大列表未虚拟化、动画掉帧）、包体积（未 tree-shake 的依赖、过大的资源未压缩）、网络（冗余请求、未缓存、瀑布流加载）、内存（泄漏、未释放的监听器/定时器）。移动端额外关注启动耗时、离屏渲染、主线程阻塞
   8. **文档同步**：代码即文档，不鼓励对代码行为的重复描述。只关注：变更是否导致 README、CLAUDE.md 等导航性文档与实际不一致；发现过时或冗余描述直接删除——没有文档好过错误的文档
   9. **工程结构**：新增文件是否放对了目录、是否遵循项目已有的分层/分包约定；是否引入循环依赖或跨层直接调用；公共模块的变更是否评估了影响范围；是否有应该复用已有模块却重复实现的代码

10. About Review：当 review 发现存在架构腐化时(for reuse, quality, efficiency, clarity, consistency, maintainability)。在不影响 test 结果的情况下，可以在当前 PR 修复小问题。改动风险大的问题，提醒人类伙伴创建 issue 来追踪。

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心架构规则尽量用 linter / CI / 类型系统执行，不依赖 Agent 自觉遵守。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在。外部文档需要搬入仓库才算数。
- **生成与评估分离**：不要让 Agent 自己评价自己的工作。Review 由独立 Agent 执行。
- **持续对抗熵增**：技术债务小额持续偿还，不等积累后痛苦处理。
- **组件可拆卸**：流程中的每个步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：CLAUDE.md / AGENTS.md 保持精简（~100 行），作为入口和导航，详细规范拆分到 `docs/` 下的专题文件中。子系统可以有自己的局部指令文件。什么都重要等于什么都不重要——信息过载导致 Agent 局部模式匹配而非全局理解。永远为 CLAUDE.md 创建一个 AGENTS.md 的软链接（`ln -s CLAUDE.md AGENTS.md`），确保不同 Agent 框架读取同一份指令。

# Subagent 使用原则

对话内 subagent（Agent 工具）共享主 Agent 的工作目录，需注意读写隔离：

- **读并行、写隔离**：多个 subagent 可以并行读（review、搜索、分析），但并行写代码**必须**使用 `isolation: "worktree"`，否则后写的会静默覆盖先写的。
- **单写不隔离**：只有一个 subagent 需要写代码时，不需要 worktree，直接写即可。
- **按需用合适的模型**：当方案足够明确时，中小颗粒度的代码编写任务派 sonnet / gpt-5.4-mini / gpt-5.3-codex-spark 即可，不需要 opus/gpt-5.4。节省 token，速度更快。
- **Review → Fix 策略**：改动少/简单的由主 Agent 直接修，不需要派 subagent。多处复杂修复需要并行 subagent 时，预判修复量大的 review 一开始就用 `isolation: "worktree"` 启动，review 完直接修，避免分两轮重建上下文浪费 token。修复量不确定的先不隔离 review，需要时再派隔离 subagent。
- **按文件/模块拆分任务**：并行 worktree subagent 从同一 commit 分叉，改不同文件可自动合并，改同一文件会产生冲突。任务边界按文件划分优于按功能划分。
- **不要手动 `git worktree`**：`isolation: "worktree"` 不只是创建 worktree，它会切换 agent 的整个工具路径上下文并自动处理合并和清理。手动做会导致 Read/Edit 等工具的路径与 Bash 不一致。

# 独立 Agent 使用指南

独立 Agent（如 Codex 插件的 rescue subagent）提供进程级隔离（独立上下文、独立模型实例），比对话内 subagent 隔离更彻底。

**适合使用的场景**：
- **独立评估/测试设计**：第 6 条中的验收标准设计，需要完全隔离当前实现上下文
- **跨模型 Review**：用不同模型互审代码（如 GPT review Claude 的代码），不同模型盲区不同，能抓到同模型互审发现不了的问题
- **长时间并行任务**：一个写代码，一个写文档/测试，互不阻塞

**不适合使用的场景**：
- 简单代码搜索、小改动——对话内 subagent 即可，独立进程开销不值得
- 需要频繁来回沟通的任务——进程间通信成本高
