/**
 * Relative Positions（相対位置 / アンカー）
 *
 * カーソル・選択範囲をリモート op が来ても壊れない形で保持するための型と変換関数。
 * 「何番目の文字の後ろ」ではなく「どのアイテムの後ろ」で位置を表現する。
 *
 * 依存する既存の型:
 *   - EditContext.itemsByLV  : LV → Item の直引きマップ
 *   - Item.originLeft        : 削除フォールバック用
 *   - Item.curState          : 削除判定
 *   - OrderStatisticTree     : curInsTotal / curInsRankOfItem / findByCurPos
 */

import { ItemState, type LV, type EditContext } from './types.js'

// ===== Anchor 型 =====

/**
 * 文書内の位置を安定的に表す型。
 *
 * - `start` : 文書の先頭（インデックス 0）
 * - `after`  : opId のアイテムの直後
 * - `end`   : 文書の末尾
 */
export type Anchor =
  | { type: 'start' }
  | { type: 'after'; opId: LV }
  | { type: 'end' }

// ===== 内部ヘルパー =====

/**
 * 削除済みアイテムを originLeft を辿って解決し、
 * 直前の生きているアイテムの直後インデックスを返す。
 * ルートまで辿っても見つからない場合は 0（文書先頭）を返す。
 */
function resolveDeletedAnchor(ctx: EditContext, opId: LV): number {
  let current = ctx.itemsByLV[opId]
  while (current && current.curState === ItemState.Deleted) {
    if (current.originLeft === -1) return 0
    current = ctx.itemsByLV[current.originLeft] ?? null
  }
  if (!current) return 0
  // current は INS アイテム。そのアイテムの直後 = rank + 1
  const rank = ctx.items.curInsRankOfItem(current)
  return rank + 1
}

// ===== 公開 API =====

/**
 * 文書インデックス → Anchor
 *
 * エディタからカーソル位置（文字列インデックス）を受け取り、
 * リモート op が来ても壊れない Anchor に変換する。
 *
 * @param ctx   チェックアウト済み EditContext（curState = endState であること）
 * @param index 文字インデックス（0 = 先頭の前、length = 末尾の後）
 */
export function indexToAnchor(ctx: EditContext, index: number): Anchor {
  if (index <= 0) return { type: 'start' }

  const total = ctx.items.curInsTotal
  if (index >= total) return { type: 'end' }

  // index-1 番目（0-indexed）の INS アイテムを探す
  const { idx } = ctx.items.findByCurPos(index - 1)
  const item = ctx.items.getByIndex(idx)
  if (!item) return { type: 'end' }

  return { type: 'after', opId: item.opId }
}

/**
 * Anchor → 文書インデックス
 *
 * リモート op 適用後にエディタへカーソル位置を反映するときに使う。
 * アンカーにしていたアイテムが削除された場合は originLeft を辿ってフォールバック。
 *
 * @param ctx    チェックアウト済み EditContext（curState = endState であること）
 * @param anchor indexToAnchor で作成した Anchor
 */
export function anchorToIndex(ctx: EditContext, anchor: Anchor): number {
  if (anchor.type === 'start') return 0
  if (anchor.type === 'end') return ctx.items.curInsTotal

  const item = ctx.itemsByLV[anchor.opId] ?? null
  if (!item || item.curState === ItemState.Deleted) {
    return resolveDeletedAnchor(ctx, anchor.opId)
  }

  // アイテムの直後 = そのアイテムより前にある INS 数 + 1（アイテム自身）
  return ctx.items.curInsRankOfItem(item) + 1
}
