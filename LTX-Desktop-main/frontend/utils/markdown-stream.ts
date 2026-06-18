/**
 * Adapted from opencode/packages/ui/src/components/markdown-stream.ts
 *
 * Splits streaming markdown text into stable + live blocks so that
 * unclosed code fences don't break the entire message rendering.
 */
import { marked } from "marked"
import remend from "remend"

export type Block = {
  raw: string
  src: string
  mode: "full" | "live"
}

function heal(text: string) {
  return remend(text, { linkMode: "text-only" })
}

function fenceUnclosed(raw: string): boolean {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
  if (!match) return false
  const mark = match[1]
  if (!mark) return false
  const char = mark[0]
  const size = mark.length
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)
}

export function stream(text: string, live: boolean): Block[] {
  if (!live) return [{ raw: text, src: text, mode: "full" }]

  const src = heal(text)

  if (/^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text)) {
    return [{ raw: text, src, mode: "live" }]
  }

  const tokens = marked.lexer(text)
  let tail = -1
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]!.type !== "space") {
      tail = i
      break
    }
  }

  if (tail < 0) return [{ raw: text, src, mode: "live" }]

  const last = tokens[tail]
  if (!last || last.type !== "code") return [{ raw: text, src, mode: "live" }]

  const code = last as { raw: string; text: string; lang?: string }
  if (!fenceUnclosed(code.raw)) return [{ raw: text, src, mode: "live" }]

  const head = tokens
    .slice(0, tail)
    .map((token) => token.raw)
    .join("")

  if (!head) return [{ raw: code.raw, src: code.raw, mode: "live" }]

  return [
    { raw: head, src: heal(head), mode: "live" },
    { raw: code.raw, src: code.raw, mode: "live" },
  ]
}
