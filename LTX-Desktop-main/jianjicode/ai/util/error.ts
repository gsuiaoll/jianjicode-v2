// Simplified error types for jianjicode
export class AuthError extends Error {}
export class CreditsError extends Error {}
export class MonthlyLimitError extends Error {}
export class UserLimitError extends Error {}
export class ModelError extends Error {}

class LimitError extends Error {
  retryAfter?: number
  constructor(message: string, retryAfter?: number) {
    super(message)
    this.retryAfter = retryAfter
  }
}
export class FreeUsageLimitError extends LimitError {}
export class SubscriptionUsageLimitError extends LimitError {}

// Utility error functions
export function createError(message: string, code?: string): Error {
  const error = new Error(message)
  ;(error as any).code = code
  return error
}

export function isLimitError(error: any): error is LimitError {
  return error instanceof LimitError
}

export class NamedError extends Error {
  static create(name: string, schema?: any) {
    return class extends NamedError {
      static errorName = name
      constructor(data: any, options?: ErrorOptions) {
        super(`${name}: ${JSON.stringify(data)}`, options)
        Object.assign(this, data)
      }
    }
  }
}
