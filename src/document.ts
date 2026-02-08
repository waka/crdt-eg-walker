/**
 * ドキュメント（OpLog + スナップショットの統合管理）
 *
 * eg-walkerの核心: CRDTの内部構造はマージ時にのみ一時的に構築し、
 * 普段はプレーンテキスト＋操作ログだけで動作する。
 */

import { localInsert, localDelete, createOpLog, mergeOplogInto } from './oplog.js'
import { checkout, mergeChangesIntoBranch } from './branch.js'
import { versionContainsLV } from './causal-graph-advanced.js'
import { lvEq } from './causal-graph.js'
import { Rope } from './rope.js'
import type { LV, ListOpLog, Branch } from './types.js'

/**
 * ブランチから全てのマージ先headsへ並行操作なしでfast-forward可能か判定。
 *
 * isFastForward(cg, from, to) は「from ⊆ to の履歴」を判定するが、
 * これだけでは不十分。例えば from=[4] to=[4,9] で 9 が 4 の子孫でない場合、
 * isFastForwardはtrueを返すが実際には並行操作がある。
 *
 * この関数は、to の全headsが from の子孫であることを確認する。
 */
export function canFastForward(
  cg: import('./types.js').CausalGraph,
  branchVersion: LV[],
  mergeHeads: LV[],
): boolean {
  if (lvEq(branchVersion, mergeHeads)) return true
  if (branchVersion.length === 0) return mergeHeads.length === 0

  for (const h of mergeHeads) {
    // このheadがブランチバージョンに既に含まれていればスキップ
    if (branchVersion.includes(h)) continue
    // ブランチの全バージョンがこのheadの祖先であることを確認
    for (const bv of branchVersion) {
      if (!versionContainsLV(cg, [h], bv)) return false
    }
  }
  return true
}

/** Document 内部状態: Rope + テキストキャッシュ */
interface DocState {
  rope: Rope | null  // 遅延構築（初回getText時）
  textCache: string | null
  needsRebuild: boolean  // Ropeの再構築が必要か
}

/** ドキュメント（OpLog + スナップショットの統合管理） */
export interface Document<T = string> {
  readonly oplog: ListOpLog<T>
  readonly branch: Branch<T>
}

/** 内部型: _state プロパティを持つ Document */
interface DocumentInternal<T = string> extends Document<T> {
  /** @internal */
  _state: DocState
}

/** Document から内部状態を取得する */
function getState<T>(doc: Document<T>): DocState {
  return (doc as DocumentInternal<T>)._state
}

/** 空のドキュメントを作成 */
export function createDocument<T = string>(): Document<T> {
  const doc: DocumentInternal<T> = {
    oplog: createOpLog<T>(),
    branch: { snapshot: [], version: [] },
    _state: { rope: new Rope(), textCache: '', needsRebuild: false },
  }
  return doc
}

/**
 * OpLogからドキュメントを開く（フルリプレイ）。
 * キャッシュがない場合のフォールバック。
 */
export function openDocument<T>(oplog: ListOpLog<T>): Document<T> {
  const doc: DocumentInternal<T> = {
    oplog,
    branch: checkout(oplog),
    _state: { rope: null, textCache: null, needsRebuild: true },
  }
  return doc
}

/**
 * キャッシュ済みスナップショットからドキュメントを即時復元。
 * eg-walkerの真の強み: 配列コピーだけでドキュメントを開ける。
 */
export function restoreDocument<T>(
  oplog: ListOpLog<T>,
  snapshot: T[],
  version: LV[],
): Document<T> {
  const doc: DocumentInternal<T> = {
    oplog,
    branch: { snapshot: snapshot.slice(), version: version.slice() },
    _state: { rope: null, textCache: null, needsRebuild: true },
  }
  return doc
}

/**
 * ローカル挿入。
 * OpLogとスナップショットの両方を直接更新する。
 * CRDT構造は不要（ローカル編集は常にfast-forward）。
 */
export function docInsert<T>(
  doc: Document<T>,
  agent: string,
  pos: number,
  ...content: T[]
): void {
  localInsert(doc.oplog, agent, pos, ...content)
  const branch = doc.branch as Branch<T>
  branch.snapshot.splice(pos, 0, ...content)

  // Rope にも挿入 + キャッシュ無効化
  const state = getState(doc)
  if (state.rope && !state.needsRebuild) {
    for (let i = 0; i < content.length; i++) {
      state.rope.insert(pos + i, String(content[i]))
    }
  } else {
    // Ropeが未構築なら次回getText時に再構築
    state.needsRebuild = true
  }
  state.textCache = null

  branch.version = doc.oplog.cg.heads.slice()
}

/**
 * ローカル削除。
 * OpLogとスナップショットの両方を直接更新する。
 * CRDT構造は不要（ローカル編集は常にfast-forward）。
 */
export function docDelete<T>(
  doc: Document<T>,
  agent: string,
  pos: number,
  len: number = 1,
): void {
  localDelete(doc.oplog, agent, pos, len)
  const branch = doc.branch as Branch<T>
  branch.snapshot.splice(pos, len)

  // Rope からも削除 + キャッシュ無効化
  const state = getState(doc)
  if (state.rope && !state.needsRebuild) {
    for (let i = 0; i < len; i++) {
      state.rope.delete(pos)
    }
  } else {
    // Ropeが未構築なら次回getText時に再構築
    state.needsRebuild = true
  }
  state.textCache = null

  branch.version = doc.oplog.cg.heads.slice()
}

/** スナップショットの内容を取得（即時） */
export function getContent<T>(doc: Document<T>): readonly T[] {
  return doc.branch.snapshot
}

/** 文字列として取得（T = string専用、キャッシュ付き） */
export function getText(doc: Document<string>): string {
  const state = getState(doc)
  if (state.textCache !== null) return state.textCache

  // Ropeが構築済みならRopeから、そうでなければsnapshotからjoin
  let text: string
  if (state.rope && !state.needsRebuild) {
    text = state.rope.toString()
  } else {
    text = doc.branch.snapshot.join('')
  }
  state.textCache = text
  return text
}

/**
 * リモートのOpLogをマージ。
 *
 * fast-forward可能ならインクリメンタル更新（CRDT構造不要）。
 * 並行編集がある場合はフルリプレイで正確な収束を保証
 * （一時的にCRDT構造を構築→競合解決→破棄）。
 */
export function mergeRemote<T>(
  doc: Document<T>,
  remoteOplog: ListOpLog<T>,
): void {
  mergeOplogInto(doc.oplog, remoteOplog)
  const branch = doc.branch as Branch<T>
  const heads = doc.oplog.cg.heads

  if (canFastForward(doc.oplog.cg, branch.version, heads)) {
    // fast-forward: スナップショットに直接適用（CRDT構造不要）
    mergeChangesIntoBranch(branch, doc.oplog)
  } else {
    // 並行編集あり: フルリプレイで正確な収束を保証
    const newBranch = checkout(doc.oplog)
    branch.snapshot = newBranch.snapshot
    branch.version = newBranch.version
  }

  // Rope は遅延再構築 + キャッシュ無効化
  const state = getState(doc)
  state.rope = null
  state.textCache = null
  state.needsRebuild = true
}
