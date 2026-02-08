/**
 * 最小ヒープベースの優先度キュー
 * 比較関数で順序を制御（負値 = 優先度高）
 */
export class PriorityQueue<T> {
  private heap: T[] = []
  private comparator: (a: T, b: T) => number

  constructor(comparator: (a: T, b: T) => number) {
    this.comparator = comparator
  }

  get size(): number {
    return this.heap.length
  }

  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /** 要素を追加 */
  push(value: T): void {
    this.heap.push(value)
    this.bubbleUp(this.heap.length - 1)
  }

  /** 最小要素を取り出す */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]!
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.sinkDown(0)
    }
    return top
  }

  /** 最小要素を参照（取り出さない） */
  peek(): T | undefined {
    return this.heap[0]
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = (idx - 1) >>> 1
      if (this.comparator(this.heap[idx]!, this.heap[parentIdx]!) >= 0) break
      this.swap(idx, parentIdx)
      idx = parentIdx
    }
  }

  private sinkDown(idx: number): void {
    const length = this.heap.length
    while (true) {
      const left = 2 * idx + 1
      const right = 2 * idx + 2
      let smallest = idx

      if (left < length && this.comparator(this.heap[left]!, this.heap[smallest]!) < 0) {
        smallest = left
      }
      if (right < length && this.comparator(this.heap[right]!, this.heap[smallest]!) < 0) {
        smallest = right
      }
      if (smallest === idx) break
      this.swap(idx, smallest)
      idx = smallest
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i]!
    this.heap[i] = this.heap[j]!
    this.heap[j] = tmp
  }
}
