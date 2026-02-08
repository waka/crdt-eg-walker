/**
 * 核心アルゴリズム: 編集コンテキスト
 *
 * apply1, retreat1, advance1, integrate, findByCurPos, traverseAndApply を実装。
 * Fugue/YjsMod CRDTの統合アルゴリズムとイベントグラフの歩行ロジック。
 *
 * 順序統計木を使い、findByCurPos を O(log n) で実行する。
 */

import {
  nextLV,
  lvCmp,
} from './causal-graph.js'
import { binarySearch } from './utils/binary-search.js'
import { diff } from './causal-graph-advanced.js'
import { OrderStatisticTree } from './order-statistic-tree.js'
import type {
  ItemState,
  Item,
  EditContext,
  ListOpLog,
  CausalGraph,
} from './types.js'
import type { SnapshotOps } from './snapshot-ops.js'

// ===== ヘルパー =====

const max2 = (a: number, b: number): number => (a > b ? a : b)
const min2 = (a: number, b: number): number => (a < b ? a : b)

// ===== ItemState ローカル定数（const enum インライン化保証） =====

const NYI = 0 as ItemState  // NotYetInserted
const INS = 1 as ItemState  // Inserted
const DEL = 2 as ItemState  // Deleted

/** ドキュメント内カーソル */
interface DocCursor {
  idx: number
  endPos: number
}

// ===== findByCurPos =====

/**
 * prepareバージョンでの文書位置からアイテムを検索する。
 * 順序統計木を使い O(log n) で検索する。
 */
function findByCurPos(ctx: EditContext, targetPos: number): DocCursor {
  const result = ctx.items.findByCurPos(targetPos, ctx._cursorHint)
  return { idx: result.idx, endPos: result.endPos }
}

/** opIdでアイテムのインデックスを検索する O(log n) */
const findItemIdx = (ctx: EditContext, needle: number): number => {
  const item = ctx.itemsByLV[needle]
  if (!item) throw Error('アイテムが見つかりません: ' + needle)
  const idx = ctx.items.indexOfItem(item)
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
    if (item.curState < INS) {
      throw Error('無効な状態 - advance削除だがアイテムの状態が: ' + item.curState)
    }
    if (item.endState < DEL) {
      throw Error('endStateが削除でないアイテムのadvance削除')
    }
    // 削除カウントを増やす
    item.curState = (item.curState + 1) as ItemState
  } else {
    if (item.curState !== NYI) {
      throw Error('既に挿入されたアイテムのadvance挿入: ' + opId)
    }
    item.curState = INS
  }

  // 状態変更後にツリーのカウンタを更新（O(log n)）
  ctx.items.refreshCountsForItem(item)
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
    if (item.curState < DEL) {
      throw Error('現在削除されていないアイテムのretreat削除')
    }
    if (item.endState < DEL) {
      throw Error('endStateが削除でないアイテムのretreat削除')
    }
  } else {
    if (item.curState !== INS) {
      throw Error('挿入状態でないアイテムのretreat挿入')
    }
  }

  // curStateを1つ戻す
  item.curState = (item.curState - 1) as ItemState

  // 状態変更後にツリーのカウンタを更新（O(log n)）
  ctx.items.refreshCountsForItem(item)
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
  const curItem = ctx.items.getByIndex(cursor.idx)
  if (
    cursor.idx >= ctx.items.length ||
    curItem === null ||
    curItem.curState !== NYI
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
    const other = ctx.items.getByIndex(scanIdx)!

    // 並行挿入の範囲を超えたら終了
    if (other.curState !== NYI) break

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

    if (other.endState === INS) scanEndPos++
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
 * 挿入: integrate→insertAt、削除: 対象特定→状態更新
 */
function apply1<T>(
  ctx: EditContext,
  snapshot: SnapshotOps<T> | null,
  oplog: ListOpLog<T>,
  opId: number,
): void {
  const op = oplog.ops[opId]!

  if (op.type === 'del') {
    // 削除: 対象アイテムを見つけてマーク
    const cursor = findByCurPos(ctx, op.pos)

    // 次のInsertedアイテムを探す
    let curItem = ctx.items.getByIndex(cursor.idx)!
    while (curItem.curState !== INS) {
      if (curItem.endState === INS) cursor.endPos++
      cursor.idx++
      curItem = ctx.items.getByIndex(cursor.idx)!
    }

    const item = curItem
    if (item.curState !== INS) {
      throw Error('現在Insertedでないアイテムを削除しようとしています')
    }

    // 出力から削除
    if (item.endState === INS) {
      if (snapshot) snapshot.delete(cursor.endPos)
    }

    // 状態を更新
    item.curState = DEL
    item.endState = DEL

    // ツリーのカウンタを更新（O(log n)）
    ctx.items.refreshCountsForItem(item)

    // この削除が対象とするアイテムを記録
    ctx.delTargets[opId] = item.opId

    // 削除後はカーソルヒントを無効化
    ctx._cursorHint = null
  } else {
    // 挿入: YjsMod統合アルゴリズムを使用
    const cursor = findByCurPos(ctx, op.pos)

    // 前のアイテムがInserted状態であることを確認
    if (cursor.idx > 0) {
      const prevItem = ctx.items.getByIndex(cursor.idx - 1)!
      if (prevItem.curState !== INS) {
        throw Error('前のアイテムがInserted状態ではありません')
      }
    }

    // originLeftは左隣のアイテムのLV
    const originLeft =
      cursor.idx === 0 ? -1 : ctx.items.getByIndex(cursor.idx - 1)!.opId

    // rightParentの検索（Fugue方式）
    let rightParent = -1
    for (let i = cursor.idx; i < ctx.items.length; i++) {
      const nextItem = ctx.items.getByIndex(i)!
      if (nextItem.curState !== NYI) {
        // Fugue方式: originLeftが同じならrightParentとする
        rightParent =
          nextItem.originLeft === originLeft ? nextItem.opId : -1
        break
      }
    }

    const newItem: Item = {
      curState: INS,
      endState: INS,
      opId,
      originLeft,
      rightParent,
    }
    ctx.itemsByLV[opId] = newItem

    // 統合アルゴリズムでカーソル位置を決定
    integrate(ctx, oplog.cg, newItem, cursor)

    // 順序統計木に挿入
    ctx.items.insertAt(cursor.idx, newItem)

    // スナップショットに挿入
    if (snapshot) snapshot.insert(cursor.endPos, op.content)

    // カーソルヒントを更新（次のfindByCurPosの開始位置）
    ctx._cursorHint = {
      pos: op.pos + 1,
      idx: cursor.idx + 1,
      endPos: cursor.endPos + 1,
    }
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
  snapshot: SnapshotOps<T> | null,
  fromOp: number = 0,
  toOp: number = nextLV(oplog.cg),
): void {
  if (fromOp === toOp) return

  const cg = oplog.cg

  // iterVersionsBetween のジェネレータをインライン化（状態マシン排除）
  let entryIdx = binarySearch(cg.entries, (e) =>
    fromOp < e.version ? -1 : fromOp >= e.vEnd ? 1 : 0,
  )
  if (entryIdx < 0) throw Error('無効または不足しているバージョン: ' + fromOp)

  for (; entryIdx < cg.entries.length; entryIdx++) {
    const entry = cg.entries[entryIdx]!
    if (entry.version >= toOp) break

    const vStart = max2(fromOp, entry.version)
    const vEnd = min2(toOp, entry.vEnd)
    const parents = vStart === entry.version ? entry.parents : [vStart - 1]

    const { aOnly, bOnly } = diff(cg, ctx.curVersion, parents)

    const retreat = aOnly
    const advance = bOnly

    // retreat/advanceがある場合、curStateが変わるためカーソルヒント無効化
    if (retreat.length > 0 || advance.length > 0) {
      ctx._cursorHint = null
    }

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
    for (let lv = vStart; lv < vEnd; lv++) {
      apply1(ctx, snapshot, oplog, lv)
    }

    // 現在のバージョンを更新
    ctx.curVersion = [vEnd - 1]
  }
}

/** 空のEditContextを作成する */
export function createEditContext(opsLength: number): EditContext {
  return {
    items: new OrderStatisticTree(),
    delTargets: new Array<number>(opsLength).fill(-1),
    itemsByLV: new Array<Item | null>(opsLength).fill(null),
    curVersion: [],
    _cursorHint: null,
  }
}
