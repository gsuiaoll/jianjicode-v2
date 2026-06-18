// Project instance for jianjicode
export class ProjectInstance {
  constructor(public path: string) {}

  static fromPath(path: string): ProjectInstance {
    return new ProjectInstance(path)
  }

  getConfig(): Record<string, unknown> {
    return {}
  }
}
