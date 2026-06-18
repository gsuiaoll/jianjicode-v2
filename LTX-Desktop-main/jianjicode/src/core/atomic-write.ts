/**
 * jianjicode Atomic Write — 防崩溃原子文件写入
 *
 * 写文件时先写入临时文件，再 rename 到目标路径。
 * 保证要么写完要么原样，不会出现截断/半写状态。
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/**
 * 原子写入文本文件。
 *
 * 策略：
 *   1. 在目标文件同一目录下创建临时文件（确保跨设备 rename 安全）
 *   2. 将内容写入临时文件并 fsync
 *   3. 将临时文件 rename 到目标路径
 *   4. Windows 上先删除目标文件再 rename
 *
 * @param filePath 目标文件路径
 * @param content  要写入的内容
 * @param encoding 编码（默认 utf-8）
 */
export function atomicWriteText(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf-8",
): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // 生成临时文件名：目标文件名 + .tmp + 随机后缀
  const tmpName = `${path.basename(filePath)}.tmp.${os.hostname()}-${process.pid}-${randomSuffix(8)}`
  const tmpPath = path.join(dir, tmpName)

  try {
    // 写入临时文件
    fs.writeFileSync(tmpPath, content, encoding)

    // 强制刷盘（以 r+ 模式打开确保 Windows 兼容）
    const fd = fs.openSync(tmpPath, "r+")
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }

    // rename 到目标路径
    // Windows: 如果目标已存在，rename 会失败，需要先 unlink
    if (process.platform === "win32" && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    // 清理临时文件
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      /* ignore cleanup errors */
    }
    throw err
  }
}

/**
 * 原子写入 JSON 文件。
 * 内部调用 atomicWriteText。
 */
export function atomicWriteJson(
  filePath: string,
  data: unknown,
  pretty = true,
): void {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  atomicWriteText(filePath, content)
}

/**
 * 生成随机字母数字后缀。
 */
function randomSuffix(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}
