/**
 * 操作ログ (OpLog) の管理
 *
 * ローカル操作の記録、外部操作の追加、OpLogのマージなど。
 */

import {
  createCG,
  nextSeqForAgent,
  add,
  addRaw,
  lvToRawList,
  summarizeVersion,
} from './causal-graph.js'
import {
  intersectWithSummary,
  diff,
  serializeDiff,
  mergePartialVersions,
} from './causal-graph-utils.js'
import type {
  RawVersion,
  ListOp,
  ListOpLog,
} from './types.js'

/** 空のOpLogを作成 */
export function createOpLog<T = string>(): ListOpLog<T> {
  return {
    ops: [],
    cg: createCG(),
  }
}

/** ローカルの挿入操作を記録 */
export function localInsert<T>(
  oplog: ListOpLog<T>,
  agent: string,
  pos: number,
  ...content: T[]
): void {
  const seq = nextSeqForAgent(oplog.cg, agent)
  add(oplog.cg, agent, seq, seq + content.length, oplog.cg.heads)
  for (const val of content) {
    oplog.ops.push({ type: 'ins', pos, content: val })
    pos++
  }
}

/** ローカルの削除操作を記録 */
export function localDelete<T>(
  oplog: ListOpLog<T>,
  agent: string,
  pos: number,
  len: number = 1,
): void {
  if (len === 0) throw Error('無効な削除長')

  const seq = nextSeqForAgent(oplog.cg, agent)
  add(oplog.cg, agent, seq, seq + len, oplog.cg.heads)
  for (let i = 0; i < len; i++) {
    oplog.ops.push({ type: 'del', pos })
  }
}

/**
 * 外部操作をOpLogに追加する。
 * 既に存在する操作の場合はfalseを返す。
 */
export function pushOp<T>(
  oplog: ListOpLog<T>,
  id: RawVersion,
  parents: RawVersion[],
  type: 'ins' | 'del',
  pos: number,
  content?: T,
): boolean {
  const entry = addRaw(oplog.cg, id, 1, parents)
  if (entry == null) return false

  if (type === 'ins' && content === undefined) {
    throw Error('挿入操作にはコンテンツが必要です')
  }
  if (entry.version !== oplog.ops.length) {
    throw Error('無効な状態: OpLogの長さとCGが一致しません')
  }

  const op: ListOp<T> =
    type === 'ins' ? { type, pos, content: content! } : { type, pos }

  oplog.ops.push(op)
  return true
}

/** 最新のバージョンを取得 */
export function getLatestVersion<T>(
  oplog: ListOpLog<T>,
): RawVersion[] {
  return lvToRawList(oplog.cg, oplog.cg.heads)
}

/**
 * srcのOpLogの内容をdestにマージする。
 */
export function mergeOplogInto<T>(
  dest: ListOpLog<T>,
  src: ListOpLog<T>,
): void {
  const vs = summarizeVersion(dest.cg)
  const [commonVersion] = intersectWithSummary(src.cg, vs)

  // commonVersionからの差分を取得
  const ranges = diff(src.cg, commonVersion, src.cg.heads).bOnly

  // 不足しているCGエントリをコピー
  const cgDiff = serializeDiff(src.cg, ranges)
  mergePartialVersions(dest.cg, cgDiff)

  // 対応する操作エントリをコピー
  for (const [start, end] of ranges) {
    dest.ops.push(...src.ops.slice(start, end))
  }
}
