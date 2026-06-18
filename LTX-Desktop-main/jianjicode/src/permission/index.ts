/**
 * jianjicode 权限系统 — 公共导出
 */

export { runInteractive, runPermissionCLI } from "./cli.js"
export { loadPermissionConfig } from "./config.js"
export {
  PermissionDeniedError,
  PermissionRejectedError,
  PermissionTimeoutError,
} from "./errors.js"
export type { EvaluateResult } from "./ruleset.js"
export { evaluate, findGloballyDenied } from "./ruleset.js"
export type { PermissionService, PermissionServiceOptions } from "./service.js"
export {
  createPermissionService,
  getGlobalPermissionService,
  permissionStorage,
  setGlobalPermissionService,
} from "./service.js"
export type { AlwaysAllowStore } from "./store.js"
export { createFileStore } from "./store.js"
export type {
  PermissionAction,
  PermissionCheck,
  PermissionConfig,
  PermissionContext,
  PermissionReply,
  PermissionRequest,
  PermissionRule,
  ReplyInput,
  Ruleset,
} from "./types.js"
export { matchWildcard } from "./wildcard.js"
