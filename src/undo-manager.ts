/**
 * UndoManager
 *
 * 協調編集での undo/redo を実現する。
 * 「直前の状態に戻す」ではなく「自分の操作だけを打ち消す逆opを生成する」。
 * 他のユーザーの操作はそのまま保たれる。
 *
 * eg-walker の優位点:
 *   Item が originLeft / rightParent を持つため、
 *   deleteの undo（再挿入）の位置決定が構造上タダで手に入る。
 *
 * スタック設計:
 *   undoStack: push() で積まれた「undo すべき操作の LV 範囲」
 *   redoStack: undo 実行時に生成された「逆op群の LV 範囲」
 *   undo/redo のたびに新しい逆op群が oplog に追加されスタックに積まれる。
 *   これにより redo の「再undo」が自然に正しく動く。
 *
 * 使い方:
 *   ```typescript
 *   const um = new UndoManager<string>('agent-A')
 *   const tx = new Transaction()
 *
 *   // 操作してグループ化
 *   const group = tx.transact(doc.oplog, () => {
 *     docInsert(doc, 'agent-A', 5, 'h', 'i')
 *   })
 *   um.push(group)
 *
 *   // undo: 逆opを oplog に適用し、redo スタックに逆op群を登録
 *   const ctx = buildUndoContext(doc.oplog)
 *   um.undo(ctx, doc.oplog, (ops) => {
 *     for (const op of ops) {
 *       if (op.type === 'del') docDelete(doc, 'agent-A', op.pos)
 *       else docInsert(doc, 'agent-A', op.pos, op.content)
 *     }
 *   })
 *   ```
 */

import { ItemState, type EditContext, type ListOpLog, type ListOp } from './types.js'
import { createEditContext, traverseAndApply } from './edit-context.js'
import { anchorToIndex, type Anchor } from './anchor.js'
import type { UndoGroup } from './transaction.js'

// ===== ヘルパー =====

/**
 * OpLog からチェックアウト済みの EditContext を構築する。
 * UndoManager の undo/redo に渡す ctx の生成に使う。
 * 毎回 O(n) のリプレイが発生するため、パフォーマンス要件が厳しい場合は
 * Document レイヤーで ctx をキャッシュすることを検討する。
 */
export function buildUndoContext<T>(opLog: ListOpLog<T>): EditContext {
  const ctx = createEditContext(opLog.ops.length)
  traverseAndApply(ctx, opLog, null)
  return ctx
}

// ===== UndoManager =====

/**
 * 協調編集対応の Undo/Redo マネージャ。
 *
 * undo/redo はコールバックで逆opを受け取り、oplog への適用は呼び出し元の責務。
 * 適用された逆opの LV 範囲を自動でトラッキングし、
 * redo（逆op の逆op）が正しく動くようにする。
 */
export class UndoManager<T = string> {
  private _undoStack: UndoGroup[] = []
  private _redoStack: UndoGroup[] = []

  /** このUndoManager が対象とするローカルエージェントID */
  readonly agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
  }

  /** undo 可能な操作があるか */
  get canUndo(): boolean {
    return this._undoStack.length > 0
  }

  /** redo 可能な操作があるか */
  get canRedo(): boolean {
    return this._redoStack.length > 0
  }

  /**
   * トランザクションのグループをスタックに積む。
   * 空グループは無視する。新規 push は redo スタックをクリアする。
   *
   * @param group Transaction.transact() が返した UndoGroup
   */
  push(group: UndoGroup): void {
    const [start, end] = group
    if (start === end) return  // 空グループは無視
    this._undoStack.push(group)
    this._redoStack = []  // 新しい操作があれば redo スタックをクリア
  }

  /**
   * 直前のグループを undo する。
   *
   * applyFn で逆op列を oplog に適用すること。適用後の LV 範囲が
   * 自動で redoStack に登録される。
   *
   * @param ctx      現在の文書状態の EditContext（buildUndoContext で生成）
   * @param opLog    現在の OpLog
   * @param applyFn  逆opを実際に oplog へ適用するコールバック
   */
  undo(
    ctx: EditContext,
    opLog: ListOpLog<T>,
    applyFn: (ops: ListOp<T>[]) => void,
  ): void {
    const group = this._undoStack.pop()
    if (!group) return

    const inverseOps = this._createInverseOps(ctx, opLog, group)

    // applyFn が oplog を更新する前後の LV 範囲を記録し redoStack に積む
    const startLV = opLog.ops.length
    if (inverseOps.length > 0) {
      applyFn(inverseOps)
    }
    // undo 操作群の LV 範囲を redoStack に積む（redo で「undo の逆」を生成するため）
    this._redoStack.push([startLV, opLog.ops.length])
  }

  /**
   * 直前の undo を redo する。
   *
   * redoStack には「undo 時に適用された逆op群の LV 範囲」が積まれており、
   * それをさらに逆転することで元の状態に戻す。
   *
   * @param ctx      現在の文書状態の EditContext（buildUndoContext で生成）
   * @param opLog    現在の OpLog
   * @param applyFn  逆opを実際に oplog へ適用するコールバック
   */
  redo(
    ctx: EditContext,
    opLog: ListOpLog<T>,
    applyFn: (ops: ListOp<T>[]) => void,
  ): void {
    const group = this._redoStack.pop()
    if (!group) return

    const inverseOps = this._createInverseOps(ctx, opLog, group)

    // redo 操作群の LV 範囲を undoStack に積む（再 undo に備えて）
    const startLV = opLog.ops.length
    if (inverseOps.length > 0) {
      applyFn(inverseOps)
    }
    this._undoStack.push([startLV, opLog.ops.length])
  }

  /**
   * グループの逆op列を生成する。
   *
   * LV を逆順に処理し、各 op の「現在の状態」を見て逆転する:
   *   - 挿入 op (lv): item.endState === Inserted → delete（現在ある → 消す）
   *   - 削除 op (lv): targetItem.endState === Deleted → insert（現在ない → 復元）
   *
   * undo/redo 両方でこの同一ロジックが機能する。
   * （redoStack には「undo 時に生成された逆op群の LV 範囲」が積まれているため、
   *    redo は「undo の逆」を生成するだけでよい）
   */
  private _createInverseOps(
    ctx: EditContext,
    opLog: ListOpLog<T>,
    group: UndoGroup,
  ): ListOp<T>[] {
    const [start, end] = group
    const results: ListOp<T>[] = []

    // 最後の操作から順に逆転（降順）
    for (let lv = end - 1; lv >= start; lv--) {
      const op = opLog.ops[lv]
      if (!op) continue

      if (op.type === 'ins') {
        // 挿入 op: 現在 Inserted なら削除する
        const item = ctx.itemsByLV[lv]
        if (!item || item.endState !== ItemState.Inserted) continue
        // アイテムの現在の可視インデックス
        const pos = ctx.items.curInsRankOfItem(item)
        results.push({ type: 'del', pos })
      } else {
        // 削除 op: 対象アイテムが現在 Deleted なら再挿入する
        const targetLV = ctx.delTargets[lv]
        if (targetLV === undefined || targetLV < 0) continue

        const item = ctx.itemsByLV[targetLV]
        if (!item || item.endState !== ItemState.Deleted) continue

        // originLeft を Anchor として挿入位置を決定（Anchor API を再利用）
        const anchor: Anchor =
          item.originLeft === -1
            ? { type: 'start' }
            : { type: 'after', opId: item.originLeft }
        const pos = anchorToIndex(ctx, anchor)

        // 元の内容は元の挿入 op から取得
        const origOp = opLog.ops[targetLV]
        if (!origOp || origOp.type !== 'ins') continue

        results.push({ type: 'ins', pos, content: origOp.content })
      }
    }

    return results
  }
}
