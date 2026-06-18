export class Env {
  static get(key: string): string | undefined {
    return process.env[key]
  }

  static all(): Record<string, string> {
    return process.env as Record<string, string>
  }
}
