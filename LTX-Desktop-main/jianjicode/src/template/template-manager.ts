/**
 * 模板管理器 — CRUD + 导入/导出
 *
 * 将模板持久化到 ~/.jianjicode/templates/ 目录，JSON 格式。
 * 内置模板从 presets/ 目录加载。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { homedir } from "os"
import { basename, join } from "path"
import type {
  TemplateCategory,
  TemplateSummary,
  VideoTemplate,
} from "./template-schema.js"
import {
  createTemplateSummary,
  getCategoryLabel,
  TEMPLATE_CATEGORIES,
  validateTemplate,
} from "./template-schema.js"

// ============================================================================
// 存储路径
// ============================================================================

function getTemplateDir(): string {
  const dir = join(homedir(), ".jianjicode", "templates")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function templatePath(id: string): string {
  return join(getTemplateDir(), `${id}.json`)
}

// ============================================================================
// 内置模板注册
// ============================================================================

const _builtinTemplates = new Map<string, VideoTemplate>()

export function registerBuiltinTemplate(template: VideoTemplate): void {
  _builtinTemplates.set(template.id, template)
}

export function registerBuiltinTemplates(templates: VideoTemplate[]): void {
  for (const t of templates) {
    _builtinTemplates.set(t.id, t)
  }
}

// ============================================================================
// CRUD 操作
// ============================================================================

export function createTemplate(template: VideoTemplate): VideoTemplate {
  const now = Date.now()
  const t: VideoTemplate = {
    ...template,
    createdAt: now,
    updatedAt: now,
  }
  validateTemplate(t)
  saveToFile(t)
  return t
}

export function saveTemplate(template: VideoTemplate): VideoTemplate {
  const now = Date.now()
  const t: VideoTemplate = {
    ...template,
    updatedAt: now,
  }
  validateTemplate(t)
  saveToFile(t)
  return t
}

export function loadTemplate(id: string): VideoTemplate | null {
  const builtin = _builtinTemplates.get(id)
  if (builtin) return { ...builtin }

  const path = templatePath(id)
  if (!existsSync(path)) return null

  try {
    const raw = readFileSync(path, "utf-8")
    const obj = JSON.parse(raw)
    return validateTemplate(obj)
  } catch {
    return null
  }
}

export function listTemplates(filter?: {
  category?: TemplateCategory
  tags?: string[]
  search?: string
}): { builtin: TemplateSummary[]; custom: TemplateSummary[] } {
  const builtinSummaries: TemplateSummary[] = []
  const customSummaries: TemplateSummary[] = []

  // 内置模板
  for (const t of _builtinTemplates.values()) {
    if (filter && !matchesFilter(t, filter)) continue
    builtinSummaries.push(createTemplateSummary(t))
  }

  // 自定义模板（磁盘）
  try {
    const dir = getTemplateDir()
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), "utf-8")
        const obj = JSON.parse(raw)
        const t = validateTemplate(obj)
        if (_builtinTemplates.has(t.id)) continue // 跳过内置
        if (filter && !matchesFilter(t, filter)) continue
        customSummaries.push(createTemplateSummary(t))
      } catch {
        // 跳过损坏文件
      }
    }
  } catch {
    // 目录为空
  }

  return { builtin: builtinSummaries, custom: customSummaries }
}

export function deleteTemplate(id: string): boolean {
  // 不允许删除内置模板
  if (_builtinTemplates.has(id)) return false

  const path = templatePath(id)
  if (!existsSync(path)) return false

  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

export function exportTemplate(id: string, exportPath?: string): string | null {
  const t = loadTemplate(id)
  if (!t) return null

  const outPath = exportPath || join(process.cwd(), `${id}_template.json`)
  writeFileSync(outPath, JSON.stringify(t, null, 2))
  return outPath
}

export function importTemplate(
  filePath: string,
  overwrite = false,
): VideoTemplate | null {
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, "utf-8")
    const obj = JSON.parse(raw)
    const t = validateTemplate(obj)

    const existing = loadTemplate(t.id)
    if (existing && !overwrite) return null

    return createTemplate(t)
  } catch {
    return null
  }
}

// ============================================================================
// 分类与标签
// ============================================================================

export function listCategories(): Array<{
  value: TemplateCategory
  label: string
  count: number
}> {
  const { builtin, custom } = listTemplates()
  const all = [...builtin, ...custom]
  return TEMPLATE_CATEGORIES.map((cat) => ({
    value: cat,
    label: getCategoryLabel(cat),
    count: all.filter((t) => t.category === cat).length,
  }))
}

export function listAllTags(): string[] {
  const { builtin, custom } = listTemplates()
  const all = [...builtin, ...custom]
  const tagSet = new Set<string>()
  for (const t of all) {
    for (const tag of t.tags) {
      tagSet.add(tag)
    }
  }
  return [...tagSet].sort()
}

// ============================================================================
// 内部辅助
// ============================================================================

function saveToFile(template: VideoTemplate): void {
  const path = templatePath(template.id)
  writeFileSync(path, JSON.stringify(template, null, 2))
}

function matchesFilter(
  t: VideoTemplate,
  filter: { category?: TemplateCategory; tags?: string[]; search?: string },
): boolean {
  if (filter.category && t.category !== filter.category) return false
  if (filter.tags && filter.tags.length > 0) {
    if (!filter.tags.some((tag) => t.tags.includes(tag))) return false
  }
  if (filter.search) {
    const s = filter.search.toLowerCase()
    if (
      !t.name.toLowerCase().includes(s) &&
      !t.description.toLowerCase().includes(s)
    )
      return false
  }
  return true
}
