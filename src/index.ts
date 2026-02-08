// 型定義
export type {
  LV,
  LVRange,
  RawVersion,
  ClientEntry,
  CGEntry,
  CausalGraph,
  ListOp,
  ListOpLog,
  Item,
  EditContext,
  Branch,
  DiffResult,
  ConflictingResult,
  VersionSummary,
} from './types.js'

export { ItemState, DiffFlag } from './types.js'

// 因果グラフ基本操作
export {
  createCG,
  add,
  addRaw,
  nextLV,
  nextSeqForAgent,
  advanceFrontier,
  hasVersion,
  assignLocal,
  findEntryContainingRaw,
  findEntryContaining,
  lvToRaw,
  lvToRawWithParents,
  lvToRawList,
  tryRawToLV,
  rawToLV,
  rawToLV2,
  rawToLVList,
  rawToLVSpan,
  rawVersionCmp,
  lvCmp,
  iterVersionsBetween,
  eachVersionBetween,
  summarizeVersion,
  lvEq,
} from './causal-graph.js'

// 因果グラフ高度操作
export {
  diff,
  isFastForward,
  versionContainsLV,
  findDominators,
  findDominators2,
  findConflicting,
  compareVersions,
  serializeDiff,
  serializeFromVersion,
  mergePartialVersions,
  intersectWithSummary,
} from './causal-graph-utils.js'

export type {
  DiffResult as CausalDiffResult,
  PartialSerializedCGEntry,
  PartialSerializedCG,
} from './causal-graph-utils.js'

// 操作ログ
export {
  createOpLog,
  localInsert,
  localDelete,
  pushOp,
  getLatestVersion,
  mergeOplogInto,
} from './oplog.js'

// 編集コンテキスト
export {
  traverseAndApply,
  createEditContext,
} from './edit-context.js'

// ブランチ
export {
  createEmptyBranch,
  checkout,
  checkoutSimple,
  checkoutSimpleString,
  mergeChangesIntoBranch,
} from './branch.js'
