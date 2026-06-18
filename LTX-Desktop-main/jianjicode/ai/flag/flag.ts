// Feature flags for jianjicode
export namespace Flag {
  export function isEnabled(flag: string): boolean {
    return process.env[`FLAG_${flag.toUpperCase()}`] === "true"
  }

  export function enable(flag: string): void {
    process.env[`FLAG_${flag.toUpperCase()}`] = "true"
  }

  export function disable(flag: string): void {
    delete process.env[`FLAG_${flag.toUpperCase()}`]
  }
}
