// Global paths and configuration for jianjicode

import { homedir } from "os"
import { join } from "path"

export namespace Global {
  export namespace Path {
    export const cache = join(homedir(), ".jianjicode", "cache")
    export const config = join(homedir(), ".jianjicode", "config")
    export const logs = join(homedir(), ".jianjicode", "logs")
  }

  export const version = "0.1.0"
  export const name = "jianjicode"
}
