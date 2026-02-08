/**
 * AVL木ベースの順序統計木
 *
 * EditContext の items 配列を置き換え、findByCurPos を O(log n) に高速化する。
 * 各ノードは Item を保持し、サブツリーのカウンタを管理する。
 * parent ポインタにより、Item → ノード → インデックスを O(log n) で計算可能。
 */

import type { Item } from './types.js'

// ItemState のローカル定数
const INS = 1 // Inserted

/** 順序統計木のノード */
export interface OSTNode {
  /** 保持する Item */
  item: Item
  /** 左の子 */
  left: OSTNode | null
  /** 右の子 */
  right: OSTNode | null
  /** 親ノード */
  parent: OSTNode | null
  /** AVL木の高さ */
  height: number
  /** サブツリーのノード数 */
  size: number
  /** サブツリー内の curState === INS のノード数 */
  curInsCount: number
  /** サブツリー内の endState === INS のノード数 */
  endInsCount: number
}

/** ノードを作成 */
function createNode(item: Item): OSTNode {
  return {
    item,
    left: null,
    right: null,
    parent: null,
    height: 1,
    size: 1,
    curInsCount: item.curState === INS ? 1 : 0,
    endInsCount: item.endState === INS ? 1 : 0,
  }
}

/** ノードの高さ（nullは0） */
function height(node: OSTNode | null): number {
  return node ? node.height : 0
}

/** ノードのサイズ（nullは0） */
function size(node: OSTNode | null): number {
  return node ? node.size : 0
}

/** ノードの curInsCount（nullは0） */
function curIns(node: OSTNode | null): number {
  return node ? node.curInsCount : 0
}

/** ノードの endInsCount（nullは0） */
function endIns(node: OSTNode | null): number {
  return node ? node.endInsCount : 0
}

/** ノードのメタデータを再計算 */
function update(node: OSTNode): void {
  node.height = 1 + Math.max(height(node.left), height(node.right))
  node.size = 1 + size(node.left) + size(node.right)
  node.curInsCount = (node.item.curState === INS ? 1 : 0) + curIns(node.left) + curIns(node.right)
  node.endInsCount = (node.item.endState === INS ? 1 : 0) + endIns(node.left) + endIns(node.right)
}

/** 子ノードの parent ポインタを設定 */
function setParent(node: OSTNode): void {
  if (node.left) node.left.parent = node
  if (node.right) node.right.parent = node
}

/** バランスファクター */
function balanceFactor(node: OSTNode): number {
  return height(node.left) - height(node.right)
}

/** 右回転 */
function rotateRight(node: OSTNode): OSTNode {
  const left = node.left!
  node.left = left.right
  left.right = node
  update(node)
  setParent(node)
  update(left)
  setParent(left)
  left.parent = node.parent
  node.parent = left
  return left
}

/** 左回転 */
function rotateLeft(node: OSTNode): OSTNode {
  const right = node.right!
  node.right = right.left
  right.left = node
  update(node)
  setParent(node)
  update(right)
  setParent(right)
  right.parent = node.parent
  node.parent = right
  return right
}

/** AVLバランス調整 */
function balance(node: OSTNode): OSTNode {
  update(node)
  const bf = balanceFactor(node)

  if (bf > 1) {
    if (balanceFactor(node.left!) < 0) {
      node.left = rotateLeft(node.left!)
      node.left.parent = node
    }
    const result = rotateRight(node)
    return result
  }

  if (bf < -1) {
    if (balanceFactor(node.right!) > 0) {
      node.right = rotateRight(node.right!)
      node.right.parent = node
    }
    const result = rotateLeft(node)
    return result
  }

  return node
}

/** 位置 idx にノードを挿入（0-indexed） */
function insertAtNode(
  root: OSTNode | null,
  idx: number,
  newNode: OSTNode,
): OSTNode {
  if (root === null) {
    return newNode
  }

  const leftSize = size(root.left)
  if (idx <= leftSize) {
    root.left = insertAtNode(root.left, idx, newNode)
    root.left.parent = root
  } else {
    root.right = insertAtNode(root.right, idx - leftSize - 1, newNode)
    root.right.parent = root
  }

  return balance(root)
}

/** インデックスでノードを取得（0-indexed） */
function getByIndexNode(root: OSTNode | null, idx: number): OSTNode | null {
  if (root === null) return null

  const leftSize = size(root.left)
  if (idx < leftSize) {
    return getByIndexNode(root.left, idx)
  } else if (idx === leftSize) {
    return root
  } else {
    return getByIndexNode(root.right, idx - leftSize - 1)
  }
}

/**
 * ノードからルートまで辿り、in-orderインデックスを計算する。O(log n)。
 */
function nodeToIndex(node: OSTNode): number {
  let idx = size(node.left)
  let current = node
  while (current.parent !== null) {
    const p = current.parent
    if (current === p.right) {
      // 右の子 → 親の左サブツリー + 親自身
      idx += size(p.left) + 1
    }
    current = p
  }
  return idx
}

/**
 * curPos に基づいてアイテムを検索する。
 *
 * 元の配列版 findByCurPos と同等のセマンティクス:
 *   curPos=0, endPos=0, i=0 から開始し、curPos < targetPos の間
 *   各アイテムの curState/endState をカウントして i を進める。
 *
 * 要するに、in-order走査で targetPos 番目の INS ノードの直後の位置を返す。
 * targetPos=0 なら先頭（idx=0, endPos=0）。
 */
function findByCurPosNode(
  root: OSTNode | null,
  targetPos: number,
): { idx: number; endPos: number } {
  if (targetPos === 0) return { idx: 0, endPos: 0 }

  let idx = 0
  let endPos = 0
  let remaining = targetPos
  let node = root

  while (node !== null) {
    const leftCurIns = curIns(node.left)
    const leftEndIns = endIns(node.left)
    const leftSize = size(node.left)

    if (remaining <= leftCurIns) {
      // ターゲットは左サブツリー内にある
      node = node.left
    } else {
      // 左サブツリー分を消費
      remaining -= leftCurIns
      idx += leftSize
      endPos += leftEndIns

      // 現在のノードを処理
      if (node.item.curState === INS) {
        remaining--
      }
      if (node.item.endState === INS) {
        endPos++
      }
      idx++

      if (remaining <= 0) {
        return { idx, endPos }
      }

      // 右サブツリーへ
      node = node.right
    }
  }

  return { idx, endPos }
}

/**
 * ヒント付き findByCurPos。
 * ヒントが有効で targetPos >= hint.pos なら、中間地点から走査する。
 */
function findByCurPosWithHint(
  root: OSTNode | null,
  totalSize: number,
  targetPos: number,
  hint: { pos: number; idx: number; endPos: number } | null,
): { idx: number; endPos: number } {
  // ヒントが近傍で使えるケース: delta が小さいとき線形スキャンが速い
  if (hint !== null && targetPos >= hint.pos) {
    const delta = targetPos - hint.pos
    if (delta <= 4) {
      let curPos = hint.pos
      let endPos = hint.endPos
      let idx = hint.idx

      while (curPos < targetPos) {
        const n = getByIndexNode(root, idx)
        if (n === null) break
        if (n.item.curState === INS) curPos++
        if (n.item.endState === INS) endPos++
        idx++
      }
      return { idx, endPos }
    }
  }

  return findByCurPosNode(root, targetPos)
}

/** 全ノードを配列として取得（in-order走査） */
function toArrayNodes(root: OSTNode | null, result: Item[]): void {
  if (root === null) return
  toArrayNodes(root.left, result)
  result.push(root.item)
  toArrayNodes(root.right, result)
}

/**
 * 順序統計木
 *
 * EditContext.items を置き換え、O(log n) の位置探索と挿入を提供する。
 */
export class OrderStatisticTree {
  /** @internal */
  _root: OSTNode | null = null
  /** Item → OSTNode の逆引き */
  private _nodeMap: Map<Item, OSTNode> = new Map()

  /** ノード数 */
  get length(): number {
    return size(this._root)
  }

  /** 位置 idx にアイテムを挿入（0-indexed） */
  insertAt(idx: number, item: Item): void {
    const newNode = createNode(item)
    this._nodeMap.set(item, newNode)
    this._root = insertAtNode(this._root, idx, newNode)
    if (this._root) this._root.parent = null
  }

  /** 末尾にアイテムを追加 */
  push(item: Item): void {
    this.insertAt(this.length, item)
  }

  /** インデックスでアイテムを取得（0-indexed） */
  getByIndex(idx: number): Item | null {
    const node = getByIndexNode(this._root, idx)
    return node ? node.item : null
  }

  /**
   * Item からインデックスを O(log n) で計算する。
   * findItemIdx の高速版。
   */
  indexOfItem(item: Item): number {
    const node = this._nodeMap.get(item)
    if (!node) return -1
    return nodeToIndex(node)
  }

  /**
   * curPos に基づいてアイテムを検索する。
   * curState === INS のノードをカウントして位置を決定。
   *
   * 返り値: { idx, endPos }
   */
  findByCurPos(
    targetPos: number,
    hint?: { pos: number; idx: number; endPos: number } | null,
  ): { idx: number; endPos: number } {
    return findByCurPosWithHint(this._root, this.length, targetPos, hint ?? null)
  }

  /**
   * アイテムの状態変更後にサブツリーカウンタを更新する。
   * 指定インデックスからルートまで再計算する。
   */
  refreshCountsAt(idx: number): void {
    this._root = refreshAt(this._root, idx)
    if (this._root) this._root.parent = null
  }

  /**
   * Item の状態変更後に、ノードからルートまでカウンタを更新する。O(log n)。
   * refreshCountsAt の Item 直接版。
   */
  refreshCountsForItem(item: Item): void {
    const node = this._nodeMap.get(item)
    if (!node) return
    // ノードからルートまでカウンタを再計算
    let current: OSTNode | null = node
    while (current !== null) {
      update(current)
      current = current.parent
    }
  }

  /** 全アイテムを配列として取得（デバッグ・互換用） */
  toArray(): Item[] {
    const result: Item[] = []
    toArrayNodes(this._root, result)
    return result
  }
}

/** 指定インデックスのノードを含むパス上の全ノードを再計算 */
function refreshAt(root: OSTNode | null, idx: number): OSTNode | null {
  if (root === null) return null

  const leftSize = size(root.left)
  if (idx < leftSize) {
    root.left = refreshAt(root.left, idx)
    if (root.left) root.left.parent = root
  } else if (idx > leftSize) {
    root.right = refreshAt(root.right, idx - leftSize - 1)
    if (root.right) root.right.parent = root
  }

  update(root)
  return root
}
