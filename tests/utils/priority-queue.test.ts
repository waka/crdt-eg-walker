import { describe, it, expect } from 'vitest'
import { PriorityQueue } from '../../src/utils/priority-queue.js'

describe('PriorityQueue', () => {
  it('空のキューはsizeが0でisEmptyがtrue', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    expect(pq.size).toBe(0)
    expect(pq.isEmpty()).toBe(true)
  })

  it('pushしたらsizeが増える', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.push(5)
    expect(pq.size).toBe(1)
    expect(pq.isEmpty()).toBe(false)
  })

  it('最小値から順にpopされる', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.push(3)
    pq.push(1)
    pq.push(4)
    pq.push(1)
    pq.push(5)
    pq.push(9)
    pq.push(2)

    expect(pq.pop()).toBe(1)
    expect(pq.pop()).toBe(1)
    expect(pq.pop()).toBe(2)
    expect(pq.pop()).toBe(3)
    expect(pq.pop()).toBe(4)
    expect(pq.pop()).toBe(5)
    expect(pq.pop()).toBe(9)
    expect(pq.pop()).toBeUndefined()
  })

  it('peekは最小要素を参照するが取り出さない', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.push(3)
    pq.push(1)
    expect(pq.peek()).toBe(1)
    expect(pq.size).toBe(2)
  })

  it('カスタム比較関数で最大ヒープとして動作する', () => {
    const pq = new PriorityQueue<number>((a, b) => b - a)
    pq.push(3)
    pq.push(1)
    pq.push(4)

    expect(pq.pop()).toBe(4)
    expect(pq.pop()).toBe(3)
    expect(pq.pop()).toBe(1)
  })

  it('オブジェクトの優先度キュー', () => {
    const pq = new PriorityQueue<{ priority: number; name: string }>(
      (a, b) => a.priority - b.priority,
    )
    pq.push({ priority: 2, name: 'B' })
    pq.push({ priority: 1, name: 'A' })
    pq.push({ priority: 3, name: 'C' })

    expect(pq.pop()!.name).toBe('A')
    expect(pq.pop()!.name).toBe('B')
    expect(pq.pop()!.name).toBe('C')
  })
})
