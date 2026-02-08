// ===== 基本型 =====

/** ローカルバージョン番号（操作の連番） */
export type LV = number

/** バージョン範囲 [start, end) */
export type LVRange = [start: number, end: number]

/** 生バージョン: [エージェントID, シーケンス番号] */
export type RawVersion = [agent: string, seq: number]

// ===== 因果グラフ (Causal Graph) =====

/** エージェントごとのバージョンマッピングエントリ */
export interface ClientEntry {
  seq: number
  seqEnd: number
  /** このランの最初のアイテムのLV */
  version: LV
}

/** 因果グラフのエントリ（RLE圧縮済み） */
export interface CGEntry {
  /** 開始バージョン */
  version: LV
  /** 終了バージョン（排他的） */
  vEnd: LV
  /** エージェントID */
  agent: string
  /** エージェント内のシーケンス番号 */
  seq: number
  /** 親バージョンのリスト */
  parents: LV[]
}

/** 因果グラフ */
export interface CausalGraph {
  /** 現在の最前線（マージされていない最新バージョン群） */
  heads: LV[]
  /** エントリのリスト（バージョン順） */
  entries: CGEntry[]
  /** エージェントID → バージョンマッピング */
  agentToVersion: Record<string, ClientEntry[]>
}

// ===== 操作ログ (OpLog) =====

/** 操作の種別 */
export type ListOpType = 'ins' | 'del'

/** リスト操作 */
export type ListOp<T = string> =
  | { type: 'ins'; pos: number; content: T }
  | { type: 'del'; pos: number }

/** 操作ログ */
export interface ListOpLog<T = string> {
  /** 操作のリスト */
  ops: ListOp<T>[]
  /** 因果グラフ */
  cg: CausalGraph
}

// ===== 編集コンテキスト (Edit Context) =====

/** アイテムの状態 */
export const enum ItemState {
  /** まだ挿入されていない */
  NotYetInserted = 0,
  /** 挿入済み（可視） */
  Inserted = 1,
  /** 削除済み */
  Deleted = 2,
}

/** FugueのYjsMod統合アルゴリズム用アイテム */
export interface Item {
  /** 操作のバージョンID */
  opId: LV
  /**
   * 現在の状態
   * prepare中のretreat/advanceで変化する
   */
  curState: ItemState
  /**
   * 最終状態
   * applyで設定され、retreat/advanceでは変化しない
   */
  endState: ItemState
  /** 左側の起点（挿入時の左隣のアイテム、-1は文書先頭） */
  originLeft: LV
  /** 右親（挿入時の右隣のアイテム、-1は文書末尾/なし） */
  rightParent: LV
}

/** 編集コンテキスト */
export interface EditContext {
  /** 文書内のアイテムリスト（順序統計木） */
  items: import('./order-statistic-tree.js').OrderStatisticTree
  /** 削除操作の対象バージョン */
  delTargets: LV[]
  /** LV → Itemの参照（高速検索用） */
  itemsByLV: (Item | null)[]
  /** 現在処理中のバージョン */
  curVersion: LV[]
  /** カーソル位置のキャッシュ（findByCurPos高速化用） */
  _cursorHint: { pos: number; idx: number; endPos: number } | null
}

// ===== ブランチ (Branch) =====

/** ブランチ（文書のスナップショット） */
export interface Branch<T = string> {
  /** 文書の内容 */
  snapshot: T[]
  /** このスナップショットに対応するバージョン */
  version: LV[]
}

// ===== diff結果 =====

/** diffの結果を表す区間 */
export interface DiffResult {
  /** バージョン範囲 */
  range: LVRange
  /** この範囲がどちらに属するか */
  flag: DiffFlag
}

/** diff区間のフラグ */
export const enum DiffFlag {
  /** aのみに含まれる */
  OnlyA = 0,
  /** bのみに含まれる */
  OnlyB = 1,
  /** a, b両方に含まれる */
  Shared = 2,
}

// ===== findConflicting結果 =====

/** findConflictingの結果 */
export interface ConflictingResult {
  /** 共通の操作範囲 */
  common: LVRange[]
  /** aのみの操作範囲 */
  aOnly: LVRange[]
  /** bのみの操作範囲 */
  bOnly: LVRange[]
}

// ===== バージョンサマリ =====

/** バージョンサマリ: エージェントごとの既知シーケンス番号範囲 */
export type VersionSummary = Record<string, LVRange[]>
