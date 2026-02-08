// ===== 型定義 =====

export type {
  LV,
  LVRange,
  RawVersion,
  CausalGraph,
  ListOp,
  ListOpLog,
  Branch,
  DiffResult,
  ConflictingResult,
  VersionSummary,
} from './types.js'

export { ItemState, DiffFlag } from './types.js'

export type { Document } from './document.js'
export type { TextDocument } from './text-document.js'

export type {
  DiffResult as CausalDiffResult,
  PartialSerializedCGEntry,
  PartialSerializedCG,
} from './causal-graph-advanced.js'

// ===== Document API =====

export {
  createDocument,
  openDocument,
  restoreDocument,
  docInsert,
  docDelete,
  getContent,
  getText,
  mergeRemote,
  canFastForward,
} from './document.js'

// ===== TextDocument API =====

export {
  createTextDocument,
  openTextDocument,
  restoreTextDocument,
  textDocInsert,
  textDocDelete,
  getTextDocText,
  mergeTextRemote,
} from './text-document.js'

// ===== OpLog API =====

export {
  createOpLog,
  localInsert,
  localDelete,
  pushOp,
  getLatestVersion,
  mergeOplogInto,
} from './oplog.js'

// ===== Branch API =====

export {
  createEmptyBranch,
  checkout,
  checkoutSimple,
  checkoutSimpleString,
  mergeChangesIntoBranch,
} from './branch.js'

// ===== CausalGraph API =====

export {
  createCG,
  add,
  addRaw,
  lvToRaw,
  lvToRawList,
  rawToLV,
  rawToLVList,
  tryRawToLV,
  summarizeVersion,
  lvEq,
} from './causal-graph.js'

export {
  diff,
  isFastForward,
  versionContainsLV,
  findDominators,
  findConflicting,
  compareVersions,
  serializeDiff,
  serializeFromVersion,
  mergePartialVersions,
  intersectWithSummary,
} from './causal-graph-advanced.js'
