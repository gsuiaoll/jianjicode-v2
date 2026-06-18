import { resolve } from "path"

/** 记录每个输出文件最后一次由哪个输入文件产生 */
const _producers = new Map<string, string>()

/**
 * 判断当前调用是否为重复调用（同一输入 → 同一输出）。
 * 如果不是重复，记录本次输入→输出关系，后续管线步骤可据此放行。
 *
 * 逻辑：
 * - 同一输入再次生产同一输出 → 重复调用 → skip
 * - 不同输入生产同一输出 → 管线串联 → 允许覆盖
 */
export function isDuplicateCall(
  inputPath: string,
  outputPath: string,
): boolean {
  const out = resolve(outputPath)
  const inp = resolve(inputPath)
  const prev = _producers.get(out)
  _producers.set(out, inp)
  return prev === inp
}
