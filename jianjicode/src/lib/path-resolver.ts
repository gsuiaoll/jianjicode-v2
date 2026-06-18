import { existsSync } from "fs"
import { resolve } from "path"

export interface ResolveResult {
  resolvedPath: string
  wasCorrected: boolean
}

export async function resolveInputPath(input: string): Promise<ResolveResult> {
  let normalized = process.platform === "win32" ? input.replace(/\//g, "\\") : input

  if (existsSync(normalized)) {
    return { resolvedPath: resolve(normalized), wasCorrected: false }
  }

  const spaceFix = normalized.replace(/\s*-\s*/g, "-")
  if (spaceFix !== normalized && existsSync(spaceFix)) {
    return { resolvedPath: resolve(spaceFix), wasCorrected: true }
  }

  const noExtraSpaces = normalized.replace(/\s+/g, " ").trim()
  if (noExtraSpaces !== normalized && existsSync(noExtraSpaces)) {
    return { resolvedPath: resolve(noExtraSpaces), wasCorrected: true }
  }

  return { resolvedPath: resolve(normalized), wasCorrected: false }
}
