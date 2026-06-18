import { EOL } from "os"

export namespace UI {
  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_DIM: "\x1b[90m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_INFO: "\x1b[94m",
  }

  export function println(...message: string[]) {
    print(...message)
    process.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    process.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo() {
    const lines = [
      "┏━━━━━━━━━━━━━━━━━━━━┓",
      "┃   JIANJICODE       ┃",
      "┃   Video Editing AI ┃",
      "┗━━━━━━━━━━━━━━━━━━━━┛",
      "",
    ]
    return lines.join(EOL)
  }

  export function error(message: string) {
    if (message.startsWith("Error: ")) {
      message = message.slice("Error: ".length)
    }
    println(Style.TEXT_DANGER + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function warn(message: string) {
    println(Style.TEXT_WARNING + "Warning: " + Style.TEXT_NORMAL + message)
  }

  export function success(message: string) {
    println(Style.TEXT_SUCCESS + "Success: " + Style.TEXT_NORMAL + message)
  }
}
