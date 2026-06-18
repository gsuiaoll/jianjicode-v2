/**
 * Skill Manager Tool — Agent 调用的 skill 管理工具
 *
 * 为 AI 暴露 8 个操作：
 * - create: 创建新 skill
 * - list: 列出已有 skills（含版本兼容标记）
 * - view: 查看 skill 详情
 * - validate: 校验 skill 参数 + 填充默认值
 * - delete: 删除废弃 skill
 * - edit: 编辑 skill 的 SKILL.md 内容
 * - patch: 对 skill 应用灰度 patch
 * - supporting: 管理 skill 的 supporting files（reference/template/script/asset）
 *
 * 与 ai/tool/skill.ts（只读加载）互补。
 *
 * @license MIT
 */

import z from "zod"
import * as skillManager from "../core/skill-manager.js"
import { Tool } from "./tool.js"

async function initSkillManageTool() {
  const list = await skillManager.listSkills()

  const description = [
    "Manage auto-created skills: create, list, view, validate, delete, edit, patch, and manage supporting files.",
    "Skills are reusable video editing workflows that can be automatically created from task execution traces.",
    "",
    list.length > 0
      ? `Available skills (${list.length}): ${list.map((s) => s.name + (s.compatible === false ? " (⚠️ outdated)" : "")).join(", ")}`
      : "No auto-created skills yet.",
  ].join("\n")

  const parameters = z.object({
    action: z
      .enum([
        "create",
        "list",
        "view",
        "validate",
        "delete",
        "edit",
        "patch",
        "supporting",
      ])
      .describe("The action to perform"),
    name: z
      .string()
      .optional()
      .describe(
        "Skill name (required for create, view, validate, delete, edit, patch, and supporting)",
      ),
    description: z
      .string()
      .optional()
      .describe("Skill description (only for create)"),
    content: z
      .string()
      .optional()
      .describe("Skill content in SKILL.md format (only for create and edit)"),
    params: z
      .record(z.unknown())
      .optional()
      .describe(
        "Parameters to validate against the skill's inputSchema (only for validate)",
      ),
    // Supporting files
    fileAction: z
      .enum(["list", "write", "read", "remove"])
      .optional()
      .describe("Supporting file action (only for supporting)"),
    fileType: z
      .enum(["reference", "template", "script", "asset"])
      .optional()
      .describe("Supporting file type (only for supporting)"),
    fileName: z
      .string()
      .optional()
      .describe("Supporting file name (only for supporting write/read/remove)"),
    fileContent: z
      .string()
      .optional()
      .describe("Supporting file content (only for supporting write)"),
  })

  const execute = async (args: any, ctx: any) => {
    const { action } = args

    const ok = (title: string, output: string) => ({
      title,
      metadata: {
        operation: "skill_manage" as const,
        success: true as boolean,
      },
      output,
    })
    const fail = (title: string, output: string) => ({
      title,
      metadata: {
        operation: "skill_manage" as const,
        success: false as boolean,
      },
      output,
    })

    if (action === "list") {
      const skills = await skillManager.listSkills()
      if (skills.length === 0) {
        return ok(
          "No skills",
          "No auto-created skills found. Complete a complex editing task to generate one.",
        )
      }
      const lines: string[] = []
      for (const s of skills) {
        const compatInfo = s.compatible === false ? " ⚠️ (version mismatch)" : ""
        const files = skillManager.listSupportingFiles(s.name)
        const filesInfo =
          files.length > 0 ? ` (${files.length} supporting files)` : ""
        lines.push(
          `- **${s.name}**${compatInfo}: ${s.description} (${s.category}, ${s.toolCount} tools)${filesInfo}`,
        )
      }
      return ok(`Skills (${skills.length})`, lines.join("\n"))
    }

    if (action === "create") {
      if (!args.name || !args.content) {
        return fail(
          "Error",
          "Both name and content are required for create action.",
        )
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(args.name)) {
        return fail(
          "Invalid name",
          `Invalid skill name "${args.name}". Use lowercase letters, numbers, and hyphens. Must start with a letter or digit.`,
        )
      }

      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs")
      const { join } = await import("node:path")

      const skillsDir = join(skillManager.getSkillsDir(), args.name)
      if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true })
      writeFileSync(join(skillsDir, "SKILL.md"), args.content, "utf-8")
      skillManager.bumpUsage(args.name)

      return ok(
        `Skill created: ${args.name}`,
        `Skill "${args.name}" has been created successfully.`,
      )
    }

    if (action === "view") {
      if (!args.name) {
        return fail("Error", "Skill name is required for view action.")
      }
      const skills = await skillManager.listSkills()
      const skill = skills.find((s: any) => s.name === args.name)
      if (!skill) {
        return fail(
          "Skill not found",
          `Skill "${args.name}" not found. Available skills: ${skills.map((s: any) => s.name).join(", ") || "none"}`,
        )
      }

      const { readFileSync } = await import("node:fs")
      const content = readFileSync(skill.filePath, "utf-8")

      // 附加 supporting files 信息
      const supportingFiles = skillManager.listSupportingFiles(args.name)
      let result = content
      if (supportingFiles.length > 0) {
        result += `\n\n---\nSupporting files (${supportingFiles.length}):\n`
        for (const f of supportingFiles) {
          result += `  [${f.type}] ${f.fileName} (${f.size} bytes, updated ${f.updatedAt.split("T")[0]})\n`
        }
      }

      return ok(`Skill: ${skill.name}`, result)
    }

    if (action === "validate") {
      if (!args.name) {
        return fail("Error", "Skill name is required for validate action.")
      }

      const result = skillManager.validateSkillParams(
        args.name,
        (args.params || {}) as Record<string, unknown>,
      )

      if (result.valid) {
        const filledSummary = Object.entries(result.filled)
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n")
        return ok(
          `Validation passed: ${args.name}`,
          [
            `Parameters for "${args.name}" are valid:`,
            ...(Object.keys(result.filled).length > 0
              ? ["", "Resolved parameters:", filledSummary]
              : ["  (no parameters needed)"]),
          ].join("\n"),
        )
      }

      return fail(
        `Validation failed: ${args.name}`,
        [
          `Parameter validation failed for "${args.name}":`,
          ...result.errors.map((e) => `  - ${e}`),
          "",
          "Fix the errors and call validate again before executing the skill.",
        ].join("\n"),
      )
    }

    if (action === "delete") {
      if (!args.name) {
        return fail("Error", "Skill name is required for delete action.")
      }

      const skills = await skillManager.listSkills()
      const skill = skills.find((s: any) => s.name === args.name)
      if (!skill) {
        return fail("Skill not found", `Skill "${args.name}" not found.`)
      }

      const deleted = skillManager.deleteSkill(args.name)
      if (deleted) {
        return ok(
          `Skill deleted: ${args.name}`,
          `Skill "${args.name}" and all its files have been permanently deleted.`,
        )
      }
      return fail("Delete failed", `Failed to delete skill "${args.name}".`)
    }

    if (action === "edit") {
      if (!args.name || !args.content) {
        return fail(
          "Error",
          "Both name and content are required for edit action.",
        )
      }

      const skills = await skillManager.listSkills()
      const skill = skills.find((s: any) => s.name === args.name)
      if (!skill) {
        return fail("Skill not found", `Skill "${args.name}" not found.`)
      }

      // 备份当前版本
      skillManager.backupSkill(args.name)

      // 写入新内容
      const { writeFileSync, existsSync } = await import("node:fs")
      const { join } = await import("node:path")
      const skillsDir = join(skillManager.getSkillsDir(), args.name)
      if (!existsSync(skillsDir)) {
        return fail("Error", `Skill directory for "${args.name}" not found.`)
      }
      writeFileSync(join(skillsDir, "SKILL.md"), args.content, "utf-8")

      // 标记使用
      skillManager.bumpUsage(args.name)

      return ok(
        `Skill edited: ${args.name}`,
        [
          `Skill "${args.name}" has been updated.`,
          "A backup of the previous version is preserved in the skill directory.",
        ].join("\n"),
      )
    }

    if (action === "patch") {
      if (!args.name || !args.content) {
        return fail(
          "Error",
          "Both name and content are required for patch action.",
        )
      }

      const skills = await skillManager.listSkills()
      const skill = skills.find((s: any) => s.name === args.name)
      if (!skill) {
        return fail("Skill not found", `Skill "${args.name}" not found.`)
      }

      // 检查是否已 broken
      if (skillManager.checkBroken(args.name)) {
        return fail(
          "Skill broken",
          [
            `Skill "${args.name}" has been patched 3+ times without success and is marked as broken.`,
            "It requires manual review. Use edit action to fix it manually.",
          ].join("\n"),
        )
      }

      // 备份 -> 写入灰度 patch
      skillManager.backupSkill(args.name)
      skillManager.writePatch(args.name, args.content)

      // 标记使用
      skillManager.bumpUsage(args.name)

      const remainingPatches =
        3 - (skillManager as any).loadUsageData?.()?.[args.name]?.patchCount ||
        0

      return ok(
        `Patch applied: ${args.name}`,
        [
          `Gray-release patch has been applied to "${args.name}".`,
          `The patch will be tested on the next execution.`,
          remainingPatches > 0
            ? `Remaining auto-patch attempts: ${remainingPatches} of 3`
            : `⚠️ This was the last auto-patch attempt. Next failure will mark the skill as broken.`,
        ].join("\n"),
      )
    }

    if (action === "supporting") {
      if (!args.name) {
        return fail("Error", "Skill name is required for supporting action.")
      }

      const fileAction = args.fileAction || "list"

      if (fileAction === "list") {
        const files = skillManager.listSupportingFiles(args.name)
        if (files.length === 0) {
          return ok(
            `Supporting files: ${args.name}`,
            `No supporting files for "${args.name}". Use supporting with fileAction "write" to add files.`,
          )
        }
        const lines = files.map(
          (f) =>
            `  [${f.type}] **${f.fileName}** — ${f.size} bytes (updated ${f.updatedAt.split("T")[0]})`,
        )
        return ok(
          `Supporting files: ${args.name} (${files.length})`,
          lines.join("\n"),
        )
      }

      if (fileAction === "write") {
        if (
          !args.fileType ||
          !args.fileName ||
          args.fileContent === undefined
        ) {
          return fail(
            "Error",
            "fileType, fileName, and fileContent are required for write action.",
          )
        }

        const result = skillManager.writeSupportingFile(
          args.name,
          args.fileType,
          args.fileName,
          args.fileContent,
        )
        if (result.success) {
          return ok(
            `File written: ${args.fileName}`,
            [
              `File "${args.fileName}" written to "${args.name}/${args.fileType}s/".`,
              `Path: ${result.filePath}`,
            ].join("\n"),
          )
        }
        return fail(
          "Write failed",
          result.error || `Failed to write "${args.fileName}".`,
        )
      }

      if (fileAction === "read") {
        if (!args.fileType || !args.fileName) {
          return fail(
            "Error",
            "fileType and fileName are required for read action.",
          )
        }

        const result = skillManager.readSupportingFile(
          args.name,
          args.fileType,
          args.fileName,
        )
        if (result.success) {
          return ok(`File: ${args.fileName}`, result.content || "(empty file)")
        }
        return fail(
          "File not found",
          result.error || `File "${args.fileName}" not found.`,
        )
      }

      if (fileAction === "remove") {
        if (!args.fileType || !args.fileName) {
          return fail(
            "Error",
            "fileType and fileName are required for remove action.",
          )
        }

        const result = skillManager.removeSupportingFile(
          args.name,
          args.fileType,
          args.fileName,
        )
        if (result.success) {
          return ok(
            `File removed: ${args.fileName}`,
            `File "${args.fileName}" has been removed from "${args.name}".`,
          )
        }
        return fail(
          "Remove failed",
          result.error || `Failed to remove "${args.fileName}".`,
        )
      }

      return fail(
        "Unknown file action",
        `Unknown file action "${fileAction}". Supported: list, write, read, remove.`,
      )
    }

    return fail(
      "Unknown action",
      `Unknown action "${action}". Supported actions: create, list, view, validate, delete, edit, patch, supporting.`,
    )
  }

  return { description, parameters, execute }
}

export const SkillManageTool = Tool.define("skill_manage", initSkillManageTool)
