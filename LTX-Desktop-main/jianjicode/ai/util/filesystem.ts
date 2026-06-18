// Simplified filesystem utilities for jianjicode
import { promises as fs } from "fs"
import { basename, dirname, join } from "path"

export async function readFile(path: string): Promise<string> {
  return fs.readFile(path, "utf-8")
}

export async function writeFile(path: string, content: string): Promise<void> {
  return fs.writeFile(path, content, "utf-8")
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export async function mkdirp(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true })
}

export function joinPath(...segments: string[]): string {
  return join(...segments)
}

export function dirName(path: string): string {
  return dirname(path)
}

export function baseName(path: string): string {
  return basename(path)
}
