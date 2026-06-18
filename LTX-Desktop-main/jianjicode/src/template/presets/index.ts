/**
 * 预设模板聚合 — 导入全部 6 个内置模板并导出数组供批量注册
 */
import type { VideoTemplate } from "../template-schema.js"
import { cinematicTemplate } from "./cinematic.js"
import { deepAnalysisTemplate } from "./deep-analysis.js"
import { fastCutTemplate } from "./fast-cut.js"
import { longFormTemplate } from "./long-form.js"
import { newsStyleTemplate } from "./news-style.js"
import { vintageTemplate } from "./vintage.js"

export const BUILTIN_TEMPLATES: VideoTemplate[] = [
  fastCutTemplate,
  longFormTemplate,
  newsStyleTemplate,
  deepAnalysisTemplate,
  cinematicTemplate,
  vintageTemplate,
]

export {
  cinematicTemplate,
  deepAnalysisTemplate,
  fastCutTemplate,
  longFormTemplate,
  newsStyleTemplate,
  vintageTemplate,
}
