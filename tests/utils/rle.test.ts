import { describe, it, expect } from 'vitest'
import { pushRLERange, findInRLERanges } from '../../src/utils/rle.js'
import type { LVRange } from '../../src/types.js'

describe('pushRLERange', () => {
  it('空配列に範囲を追加する', () => {
    const ranges: LVRange[] = []
    pushRLERange(ranges, 0, 3)
    expect(ranges).toEqual([[0, 3]])
  })

  it('連続した範囲をマージする', () => {
    const ranges: LVRange[] = [[0, 3]]
    pushRLERange(ranges, 3, 5)
    expect(ranges).toEqual([[0, 5]])
  })

  it('連続しない範囲は別エントリとして追加する', () => {
    const ranges: LVRange[] = [[0, 3]]
    pushRLERange(ranges, 5, 8)
    expect(ranges).toEqual([[0, 3], [5, 8]])
  })

  it('複数回のマージが連鎖する', () => {
    const ranges: LVRange[] = []
    pushRLERange(ranges, 0, 2)
    pushRLERange(ranges, 2, 4)
    pushRLERange(ranges, 4, 6)
    expect(ranges).toEqual([[0, 6]])
  })
})

describe('findInRLERanges', () => {
  it('空配列では-1を返す', () => {
    expect(findInRLERanges([], 0)).toBe(-1)
  })

  it('含まれる範囲のインデックスを返す', () => {
    const ranges: LVRange[] = [[0, 3], [5, 8], [10, 15]]
    expect(findInRLERanges(ranges, 0)).toBe(0)
    expect(findInRLERanges(ranges, 2)).toBe(0)
    expect(findInRLERanges(ranges, 5)).toBe(1)
    expect(findInRLERanges(ranges, 7)).toBe(1)
    expect(findInRLERanges(ranges, 10)).toBe(2)
    expect(findInRLERanges(ranges, 14)).toBe(2)
  })

  it('含まれない値では-1を返す', () => {
    const ranges: LVRange[] = [[0, 3], [5, 8], [10, 15]]
    expect(findInRLERanges(ranges, 3)).toBe(-1)  // 排他的境界
    expect(findInRLERanges(ranges, 4)).toBe(-1)
    expect(findInRLERanges(ranges, 8)).toBe(-1)
    expect(findInRLERanges(ranges, 9)).toBe(-1)
    expect(findInRLERanges(ranges, 15)).toBe(-1)
    expect(findInRLERanges(ranges, 20)).toBe(-1)
  })
})
