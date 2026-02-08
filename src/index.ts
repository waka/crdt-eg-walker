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
} from './causal-graph-advanced.js'

export type {
  DiffResult as CausalDiffResult,
  PartialSerializedCGEntry,
  PartialSerializedCG,
} from './causal-graph-advanced.js'

// 操作ログ
export {
  createOpLog,
  localInsert,
  localDelete,
  pushOp,
  getLatestVersion,
  mergeOplogInto,
} from './oplog.js'

// スナップショット操作
export type { SnapshotOps } from './snapshot-ops.js'
export { wrapArray } from './snapshot-ops.js'

// Rope
export { Rope } from './rope.js'

// 順序統計木
export { OrderStatisticTree } from './order-statistic-tree.js'

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

// ドキュメント（OpLog + スナップショットの統合管理）
export type { Document } from './document.js'
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

// テキスト特化ドキュメント
export type { TextDocument } from './text-document.js'
export {
  createTextDocument,
  openTextDocument,
  restoreTextDocument,
  textDocInsert,
  textDocDelete,
  getTextDocText,
  mergeTextRemote,
} from './text-document.js'
