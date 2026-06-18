// IIFE utilities for jianjicode
export function wrapInIIFE(code: string): string {
  return `(function() { ${code} })()`
}

export function createIIFE(module: any): string {
  return `(function() { return ${JSON.stringify(module)} })()`
}
