/**
 * AVL平衡二分木ベースのRope
 *
 * 文字列の挿入・削除を O(log n) で行い、
 * toString() はチャンク単位の連結で効率的に文字列化する。
 * SnapshotOps<string> を実装し、edit-context から利用可能。
 */

import type { SnapshotOps } from './snapshot-ops.js'

/** リーフノードの最大チャンクサイズ */
const MAX_LEAF = 512

/** リーフノードの分割閾値（これを超えたら分割） */
const SPLIT_THRESHOLD = MAX_LEAF * 2

/** Ropeの内部ノード */
interface RopeNode {
  /** 左の子 */
  left: RopeNode | null
  /** 右の子 */
  right: RopeNode | null
  /** リーフのテキスト（内部ノードはnull） */
  text: string | null
  /** サブツリー全体の文字数 */
  length: number
  /** AVL木の高さ */
  height: number
}

/** リーフノードを作成 */
function createLeaf(text: string): RopeNode {
  return {
    left: null,
    right: null,
    text,
    length: text.length,
    height: 1,
  }
}

/** 内部ノードを作成（子ノードのメタデータを自動計算） */
function createInternal(left: RopeNode, right: RopeNode): RopeNode {
  return {
    left,
    right,
    text: null,
    length: left.length + right.length,
    height: 1 + Math.max(left.height, right.height),
  }
}

/** ノードのメタデータを再計算 */
function updateNode(node: RopeNode): void {
  if (node.text !== null) {
    // リーフ
    node.length = node.text.length
    node.height = 1
  } else {
    const lh = node.left ? node.left.height : 0
    const rh = node.right ? node.right.height : 0
    node.length = (node.left ? node.left.length : 0) + (node.right ? node.right.length : 0)
    node.height = 1 + Math.max(lh, rh)
  }
}

/** バランスファクター（左 - 右の高さ差） */
function balanceFactor(node: RopeNode): number {
  const lh = node.left ? node.left.height : 0
  const rh = node.right ? node.right.height : 0
  return lh - rh
}

/** 右回転 */
function rotateRight(node: RopeNode): RopeNode {
  const left = node.left!
  node.left = left.right
  left.right = node
  updateNode(node)
  updateNode(left)
  return left
}

/** 左回転 */
function rotateLeft(node: RopeNode): RopeNode {
  const right = node.right!
  node.right = right.left
  right.left = node
  updateNode(node)
  updateNode(right)
  return right
}

/** AVLバランス調整 */
function balance(node: RopeNode): RopeNode {
  updateNode(node)
  const bf = balanceFactor(node)

  if (bf > 1) {
    // 左が重い
    if (balanceFactor(node.left!) < 0) {
      // LR: 左の子を左回転してからLL
      node.left = rotateLeft(node.left!)
    }
    return rotateRight(node)
  }

  if (bf < -1) {
    // 右が重い
    if (balanceFactor(node.right!) > 0) {
      // RL: 右の子を右回転してからRR
      node.right = rotateRight(node.right!)
    }
    return rotateLeft(node)
  }

  return node
}

/** ノードに文字を挿入（pos は 0-indexed） */
function insertAt(node: RopeNode | null, pos: number, ch: string): RopeNode {
  if (node === null) {
    return createLeaf(ch)
  }

  if (node.text !== null) {
    // リーフノード: テキストに直接挿入
    const newText = node.text.slice(0, pos) + ch + node.text.slice(pos)
    if (newText.length <= SPLIT_THRESHOLD) {
      node.text = newText
      node.length = newText.length
      return node
    }
    // 閾値超え: 分割
    const mid = newText.length >> 1
    return createInternal(
      createLeaf(newText.slice(0, mid)),
      createLeaf(newText.slice(mid)),
    )
  }

  // 内部ノード: 左右に振り分け
  const leftLen = node.left ? node.left.length : 0
  if (pos <= leftLen) {
    node.left = insertAt(node.left, pos, ch)
  } else {
    node.right = insertAt(node.right, pos - leftLen, ch)
  }

  return balance(node)
}

/** ノードから1文字削除（pos は 0-indexed） */
function deleteAt(node: RopeNode, pos: number): RopeNode | null {
  if (node.text !== null) {
    // リーフノード
    const newText = node.text.slice(0, pos) + node.text.slice(pos + 1)
    if (newText.length === 0) return null
    node.text = newText
    node.length = newText.length
    return node
  }

  // 内部ノード
  const leftLen = node.left ? node.left.length : 0
  if (pos < leftLen) {
    const newLeft = deleteAt(node.left!, pos)
    if (newLeft === null) {
      return node.right
    }
    node.left = newLeft
  } else {
    const newRight = deleteAt(node.right!, pos - leftLen)
    if (newRight === null) {
      return node.left
    }
    node.right = newRight
  }

  return balance(node)
}

/** サブツリーのテキストを配列に収集 */
function collectChunks(node: RopeNode | null, chunks: string[]): void {
  if (node === null) return
  if (node.text !== null) {
    chunks.push(node.text)
    return
  }
  collectChunks(node.left, chunks)
  collectChunks(node.right, chunks)
}

/**
 * AVL平衡二分木ベースのRope
 *
 * - insert(pos, text): O(log n)
 * - delete(pos): O(log n)
 * - toString(): O(n) だがチャンク連結で高速
 * - length: O(1)
 */
export class Rope implements SnapshotOps<string> {
  /** @internal */
  _root: RopeNode | null = null

  /** 全体の文字数 */
  get length(): number {
    return this._root ? this._root.length : 0
  }

  /** 位置 pos に1文字挿入 */
  insert(pos: number, content: string): void {
    this._root = insertAt(this._root, pos, content)
  }

  /** 位置 pos の1文字を削除 */
  delete(pos: number): void {
    if (this._root === null) return
    this._root = deleteAt(this._root, pos)
  }

  /** 文字列に変換（チャンク連結） */
  toString(): string {
    if (this._root === null) return ''
    const chunks: string[] = []
    collectChunks(this._root, chunks)
    return chunks.join('')
  }
}
