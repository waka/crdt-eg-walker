/**
 * Transaction
 *
 * 複数の操作をひとつの論理的な変更としてまとめる。
 *
 * 用途:
 *   - オブザーバーへの通知をバッチ化（1操作ごとに再描画させない）
 *   - UndoManager のグループ化単位を制御する
 *
 * UndoGroup = LVRange = [start, end) で連続した LV 範囲を表す。
 * ローカル操作は常にシーケンシャルな LV を持つため LVRange で十分。
 */

import type { LVRange, ListOpLog } from './types.js'

/**
 * アンドゥの単位となる LV 範囲。
 * [start, end) の半開区間（end は排他的）。
 * ローカル操作は常に連続した LV を持つため LVRange で表現できる。
 */
export type UndoGroup = LVRange

/**
 * トランザクション管理クラス。
 *
 * `transact` でコールバック内の操作をひとつの UndoGroup にまとめる。
 * UndoManager への push はトランザクション外の責務（疎結合）。
 *
 * @example
 * ```typescript
 * const tx = new Transaction()
 * const group = tx.transact(oplog, () => {
 *   docInsert(doc, 'A', 5, 'h', 'i')
 * })
 * undoManager.push(group)
 * ```
 */
export class Transaction {
  /**
   * コールバック内で追加されたすべての操作を UndoGroup としてまとめる。
   *
   * @param opLog  操作を追加する対象のOpLog
   * @param fn     ドキュメント操作を行うコールバック
   * @returns      コールバック内で追加された操作の LV 範囲
   */
  transact<T>(opLog: ListOpLog<T>, fn: () => void): UndoGroup {
    // fn 実行前の次の LV を記録
    const startLV = opLog.ops.length
    fn()
    // fn 実行後の次の LV → [startLV, endLV) が今回のグループ
    return [startLV, opLog.ops.length]
  }
}
