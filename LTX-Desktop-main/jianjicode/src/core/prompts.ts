/**
 * jianjicode 自进化系统 — 结构化 LLM Prompt 模板
 *
 * 所有 LLM 调用的 Prompt 统一维护在此，方便优化和调试。
 * 全部使用 JSON 输出格式，便于解析和校验。
 *
 * @license MIT
 */

export const PROMPTS = {
  /**
   * Phase 1: 通用性判定 — 判断执行轨迹是否为可复用的通用剪辑工作流。
   */
  isReusableWorkflow: `你是一个专业的视频剪辑工作流分析师。请判断以下执行轨迹是否为【可复用的通用剪辑工作流】。

【判断标准】
- ✅ 可复用：流程不依赖特定视频的具体时间点、特定素材，适用于同类视频的通用处理（如"给vlog加片头+字幕+片尾"）
- ❌ 不可复用：流程依赖特定视频的定制化操作（如"给第10-20秒加模糊"、"给这个特定的视频加滤镜"）

【执行轨迹】
{steps}

请按以下JSON格式输出，不要有任何其他文字：
{"reusable": true/false, "reason": "简短说明原因"}`,

  /**
   * Phase 1: Skill 生成（含 inputSchema）。
   * 从执行轨迹生成标准化的 SKILL.md 文件。
   */
  generateSkill: `你是一个专业的视频剪辑技能设计师。请根据以下执行轨迹，生成一个可复用的 SKILL.md 文件。

【要求】
1. name：简洁明了的英文名称，使用 kebab-case（如 "vintage-film-look"）
2. description：清晰的中文描述，说明技能的用途
3. category：从以下选项中选择一个：color-grading, subtitle, transition, effect, export, analysis, other
4. tags：相关标签数组，帮助分类和检索
5. inputSchema：严格的 JSON Schema 定义参数结构，确保 AI 下次调用时能准确传参
6. 步骤：用中文描述，清晰明确，每一步都包含具体的工具和参数
7. 注意事项：如果有边界情况或常见错误，在结尾注明

【约束】
- 仅基于 jianjicode 自有工具生成，不复制任何第三方代码
- 步骤不能引用特定视频文件路径、时间戳或素材名称
- inputSchema 中 required 字段越少越好，尽量提供 default 值

【执行轨迹】
{steps}

请直接输出完整的 SKILL.md 内容，不要有任何其他文字。`,

  /**
   * Phase 2: 错误归因 — 判断错误是否为 Skill 本身的问题。
   */
  errorAttribution: `你是一个专业的 AI Agent 调试专家。请分析以下错误日志，判断错误原因是否为【Skill 本身的步骤/参数/工具调用逻辑错误】。

【判断标准】
- ✅ Skill 问题：步骤描述错误、参数传错、工具调用方式不对、工具参数不匹配
- ❌ 非 Skill 问题：用户输入错误、API 临时波动、源文件损坏、网络问题、文件不存在

【错误日志】
{errorLog}

【Skill 内容】
{skillContent}

请按以下 JSON 格式输出，不要有任何其他文字：
{"isSkillProblem": true/false, "reason": "简短说明原因", "fixSuggestion": "如果是Skill问题，给出具体修复建议；否则留空"}`,

  /**
   * Phase 3: Curator review — 后台技能审查。
   */
  /**
   * Tool Arg Repair: 工具参数修复。
   * 分析工具调用错误，修复参数使其能正确执行。
   */
  toolArgRepair: `你是一个工具调用修复专家。分析以下工具调用的错误信息，修复参数使其能正确执行。

【工具名称】
{toolName}

【原始参数（JSON）】
{originalArgs}

【错误信息】
{errorMessage}

{toolDescription}

{toolSchema}

要求：
1. 分析错误原因，确定需要修改的参数
2. 只修改有问题的参数，无问题的参数保持原值
3. 输出格式必须为合法 JSON

直接输出 JSON：
{"correctedArgs": {...}, "explanation": "简短修改说明"}
不要有任何其他文字。`,

  curatorReview: `你是一个视频编辑技能审查员。分析以下会话记录，判断是否存在可供提炼的通用剪辑工作流模式。

【原则】
- 不删除任何现有技能
- 不碰 pinned 标记的技能
- 只分析 agent-created 的技能
- 只做合并或优化建议，不做实际修改

【待分析的会话记录】
{sessions}

请按以下 JSON 格式输出，不要有任何其他文字：
{"suggestions": [{"type": "merge|optimize|archive", "reason": "..."}]}`,
}
