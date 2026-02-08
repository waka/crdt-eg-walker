import { describe, it, expect } from 'vitest'
import { binarySearch } from '../../src/utils/binary-search.js'

describe('binarySearch', () => {
  it('空配列では-1を返す', () => {
    expect(binarySearch([], () => 0)).toBe(-1)
  })

  it('要素が見つかった場合はそのインデックスを返す', () => {
    const arr = [1, 3, 5, 7, 9]
    expect(binarySearch(arr, (x) => 5 - x)).toBe(2)
    expect(binarySearch(arr, (x) => 1 - x)).toBe(0)
    expect(binarySearch(arr, (x) => 9 - x)).toBe(4)
  })

  it('要素が見つからない場合は負の挿入位置を返す', () => {
    const arr = [1, 3, 5, 7, 9]
    // 0は先頭に挿入 → -(0) - 1 = -1
    expect(binarySearch(arr, (x) => 0 - x)).toBe(-1)
    // 4は位置2に挿入 → -(2) - 1 = -3
    expect(binarySearch(arr, (x) => 4 - x)).toBe(-3)
    // 10は末尾に挿入 → -(5) - 1 = -6
    expect(binarySearch(arr, (x) => 10 - x)).toBe(-6)
  })

  it('単一要素の配列で動作する', () => {
    expect(binarySearch([5], (x) => 5 - x)).toBe(0)
    expect(binarySearch([5], (x) => 3 - x)).toBe(-1)
    expect(binarySearch([5], (x) => 7 - x)).toBe(-2)
  })
})
