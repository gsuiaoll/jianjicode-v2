// Stub for proxied utilities
export function createProxy<T extends object>(target: T): T {
  return target
}

export function proxied<T extends object>(target?: T): T | undefined {
  return target
}
