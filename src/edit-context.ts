/**
 * 核心アルゴリズム: 編集コンテキスト
 *
 * apply1, retreat1, advance1, integrate, findByCurPos, traverseAndApply を実装。
 * Fugue/YjsMod CRDTの統合アルゴリズムとイベントグラフの歩行ロジック。
 */

import {
  iterVersionsBetween,
  nextLV,
  lvCmp,
} from './causal-graph.js'
import { diff } from './causal-graph-utils.js'
import { ItemState } from './types.js'
import type {
  Item,
  EditContext,
  ListOpLog,
  CausalGraph,
} from './types.js'

// ===== ヘルパー =====

/** アイテムの表示幅（Insertedなら1、それ以外は0） */
const itemWidth = (state: ItemState): number =>
  state === ItemState.Inserted ? 1 : 0

/** ドキュメント内カーソル */
interface DocCursor {
  idx: number
  endPos: number
}

// ===== findByCurPos =====

/**
 * prepareバージョンでの文書位置からアイテムを検索する。
 * targetPosの位置にカーソルを返す。
 */
function findByCurPos(ctx: EditContext, targetPos: number): DocCursor {
  let curPos = 0
  let endPos = 0
  let i = 0

  while (curPos < targetPos) {
    if (i >= ctx.items.length) {
      throw Error('ドキュメントがtargetPosに到達するのに十分な長さではありません')
    }

    const item = ctx.items[i]!
    curPos += itemWidth(item.curState)
    endPos += itemWidth(item.endState)
    i++
  }

  return { idx: i, endPos }
}

/** opIdでアイテムのインデックスを検索する */
const findItemIdx = (ctx: EditContext, needle: number): number => {
  const idx = ctx.items.findIndex((i) => i.opId === needle)
  if (idx === -1) throw Error('アイテムが見つかりません: ' + needle)
  return idx
}

// ===== advance1 =====

/**
 * retreatした操作を再適用する。
 * curStateを操作に応じて変更する（endStateは変更しない）。
 */
function advance1<T>(
  ctx: EditContext,
  oplog: ListOpLog<T>,
  opId: number,
): void {
  const op = oplog.ops[opId]!
  const targetLV = op.type === 'del' ? ctx.delTargets[opId]! : opId
  const item = ctx.itemsByLV[targetLV]!

  if (op.type === 'del') {
    if (item.curState < ItemState.Inserted) {
      throw Error('無効な状態 - advance削除だがアイテムの状態が: ' + item.curState)
    }
    if (item.endState < ItemState.Deleted) {
      throw Error('endStateが削除でないアイテムのadvance削除')
    }
    // 削除カウントを増やす
    item.curState = (item.curState + 1) as ItemState
  } else {
    if (item.curState !== ItemState.NotYetInserted) {
      throw Error('既に挿入されたアイテムのadvance挿入: ' + opId)
    }
    item.curState = ItemState.Inserted
  }
}

// ===== retreat1 =====

/**
 * prepareバージョンから操作を取り消す。
 * curStateを変更するが、endStateは変更しない。
 */
function retreat1<T>(
  ctx: EditContext,
  oplog: ListOpLog<T>,
  opId: number,
): void {
  const op = oplog.ops[opId]!
  const targetLV = op.type === 'del' ? ctx.delTargets[opId]! : opId
  const item = ctx.itemsByLV[targetLV]!

  if (op.type === 'del') {
    if (item.curState < ItemState.Deleted) {
      throw Error('現在削除されていないアイテムのretreat削除')
    }
    if (item.endState < ItemState.Deleted) {
      throw Error('endStateが削除でないアイテムのretreat削除')
    }
  } else {
    if (item.curState !== ItemState.Inserted) {
      throw Error('挿入状態でないアイテムのretreat挿入')
    }
  }

  // curStateを1つ戻す
  item.curState = (item.curState - 1) as ItemState
}

// ===== integrate =====

/**
 * FugueMax/YjsMod統合アルゴリズム。
 * 並行挿入がある場合に、正しい挿入位置を決定する。
 *
 * カーソルの位置を更新して、正しい挿入位置を設定する。
 */
function integrate(
  ctx: EditContext,
  cg: CausalGraph,
  newItem: Item,
  cursor: DocCursor,
): void {
  // 並行挿入がなければスキャン不要
  if (
    cursor.idx >= ctx.items.length ||
    ctx.items[cursor.idx]!.curState !== ItemState.NotYetInserted
  ) {
    return
  }

  let scanning = false
  let scanIdx = cursor.idx
  let scanEndPos = cursor.endPos

  const leftIdx = cursor.idx - 1
  const rightIdx =
    newItem.rightParent === -1
      ? ctx.items.length
      : findItemIdx(ctx, newItem.rightParent)

  while (scanIdx < ctx.items.length) {
    const other = ctx.items[scanIdx]!

    // 並行挿入の範囲を超えたら終了
    if (other.curState !== ItemState.NotYetInserted) break

    if (other.opId === newItem.rightParent) {
      throw Error('無効な状態')
    }

    const oleftIdx =
      other.originLeft === -1 ? -1 : findItemIdx(ctx, other.originLeft)

    if (oleftIdx < leftIdx) break
    else if (oleftIdx === leftIdx) {
      const orightIdx =
        other.rightParent === -1
          ? ctx.items.length
          : findItemIdx(ctx, other.rightParent)

      if (
        orightIdx === rightIdx &&
        lvCmp(cg, newItem.opId, other.opId) < 0
      ) {
        break
      } else {
        scanning = orightIdx < rightIdx
      }
    }

    scanEndPos += itemWidth(other.endState)
    scanIdx++

    if (!scanning) {
      cursor.idx = scanIdx
      cursor.endPos = scanEndPos
    }
  }
}

// ===== apply1 =====

/**
 * 操作を適用する。
 * 挿入: integrate→splice、削除: 対象特定→状態更新
 */
function apply1<T>(
  ctx: EditContext,
  snapshot: T[] | null,
  oplog: ListOpLog<T>,
  opId: number,
): void {
  const op = oplog.ops[opId]!

  if (op.type === 'del') {
    // 削除: 対象アイテムを見つけてマーク
    const cursor = findByCurPos(ctx, op.pos)

    // 次のInsertedアイテムを探す
    while (ctx.items[cursor.idx]!.curState !== ItemState.Inserted) {
      const item = ctx.items[cursor.idx]!
      cursor.endPos += itemWidth(item.endState)
      cursor.idx++
    }

    const item = ctx.items[cursor.idx]!
    if (item.curState !== ItemState.Inserted) {
      throw Error('現在Insertedでないアイテムを削除しようとしています')
    }

    // 出力から削除
    if (item.endState === ItemState.Inserted) {
      if (snapshot) snapshot.splice(cursor.endPos, 1)
    }

    // 状態を更新
    item.curState = ItemState.Deleted
    item.endState = ItemState.Deleted

    // この削除が対象とするアイテムを記録
    ctx.delTargets[opId] = item.opId
  } else {
    // 挿入: YjsMod統合アルゴリズムを使用
    const cursor = findByCurPos(ctx, op.pos)

    // 前のアイテムがInserted状態であることを確認
    if (cursor.idx > 0) {
      const prevItem = ctx.items[cursor.idx - 1]!
      if (prevItem.curState !== ItemState.Inserted) {
        throw Error('前のアイテムがInserted状態ではありません')
      }
    }

    // originLeftは左隣のアイテムのLV
    const originLeft =
      cursor.idx === 0 ? -1 : ctx.items[cursor.idx - 1]!.opId

    // rightParentの検索（Fugue方式）
    let rightParent = -1
    for (let i = cursor.idx; i < ctx.items.length; i++) {
      const nextItem = ctx.items[i]!
      if (nextItem.curState !== ItemState.NotYetInserted) {
        // Fugue方式: originLeftが同じならrightParentとする
        rightParent =
          nextItem.originLeft === originLeft ? nextItem.opId : -1
        break
      }
    }

    const newItem: Item = {
      curState: ItemState.Inserted,
      endState: ItemState.Inserted,
      opId,
      originLeft,
      rightParent,
    }
    ctx.itemsByLV[opId] = newItem

    // 統合アルゴリズムでカーソル位置を決定
    integrate(ctx, oplog.cg, newItem, cursor)

    // アイテムリストに挿入
    ctx.items.splice(cursor.idx, 0, newItem)

    // スナップショットに挿入
    if (snapshot) snapshot.splice(cursor.endPos, 0, op.content)
  }
}

// ===== traverseAndApply =====

/**
 * イベントグラフを歩行して操作を適用するメインループ。
 *
 * 操作を順番に処理し、各操作の親バージョンに合わせて
 * retreat/advanceでコンテキストの状態を調整してからapply。
 */
export function traverseAndApply<T>(
  ctx: EditContext,
  oplog: ListOpLog<T>,
  snapshot: T[] | null,
  fromOp: number = 0,
  toOp: number = nextLV(oplog.cg),
): void {
  for (const entry of iterVersionsBetween(oplog.cg, fromOp, toOp)) {
    const { aOnly, bOnly } = diff(oplog.cg, ctx.curVersion, entry.parents)

    const retreat = aOnly
    const advance = bOnly

    // Retreat: 逆順で処理（削除を元に戻してから挿入を元に戻す）
    for (let i = retreat.length - 1; i >= 0; i--) {
      const [start, end] = retreat[i]!
      for (let lv = end - 1; lv >= start; lv--) {
        retreat1(ctx, oplog, lv)
      }
    }

    // Advance: 順方向で処理
    for (const [start, end] of advance) {
      for (let lv = start; lv < end; lv++) {
        advance1(ctx, oplog, lv)
      }
    }

    // Apply: 操作を適用
    for (let lv = entry.version; lv < entry.vEnd; lv++) {
      apply1(ctx, snapshot, oplog, lv)
    }

    // 現在のバージョンを更新
    ctx.curVersion = [entry.vEnd - 1]
  }
}

/** 空のEditContextを作成する */
export function createEditContext(opsLength: number): EditContext {
  return {
    items: [],
    delTargets: new Array<number>(opsLength).fill(-1),
    itemsByLV: new Array<Item | null>(opsLength).fill(null),
    curVersion: [],
  }
}
