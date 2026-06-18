// Installation utilities for jianjicode
export namespace Installation {
  export function getPath(): string {
    return process.cwd()
  }

  export function isInstalled(): boolean {
    return true
  }
}
