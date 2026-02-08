import { describe, it, expect } from 'vitest'
import { createCG, add } from '../src/causal-graph.js'
import {
  diff,
  versionContainsLV,
  findDominators,
  findConflicting,
  compareVersions,
  serializeDiff,
  mergePartialVersions,
  intersectWithSummary,
} from '../src/causal-graph-advanced.js'
import { summarizeVersion } from '../src/causal-graph.js'
import { DiffFlag } from '../src/types.js'
import type { LVRange } from '../src/types.js'

describe('diff', () => {
  it('同一バージョン間のdiffは空', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])

    const result = diff(cg, [2], [2])
    expect(result.aOnly).toEqual([])
    expect(result.bOnly).toEqual([])
  })

  it('直列の場合はbOnlyに差分が出る', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    const result = diff(cg, [2], [4])
    expect(result.aOnly).toEqual([])
    expect(result.bOnly).toEqual([[3, 5]])
  })

  it('並行操作の場合はaOnlyとbOnlyに差分が出る', () => {
    const cg = createCG()
    // 共通祖先: v0
    add(cg, 'A', 0, 1, [])
    // Aのブランチ: v1,v2
    add(cg, 'A', 1, 3, [0])
    // Bのブランチ: v3,v4
    add(cg, 'B', 0, 2, [0])

    const result = diff(cg, [2], [4])
    expect(result.aOnly).toEqual([[1, 3]])
    expect(result.bOnly).toEqual([[3, 5]])
  })

  it('共通祖先がない場合（空バージョンから分岐）', () => {
    const cg = createCG()
    add(cg, 'A', 0, 2, [])  // v0,v1
    add(cg, 'B', 0, 2, [])  // v2,v3 (親なし=並行)

    const result = diff(cg, [1], [3])
    expect(result.aOnly).toEqual([[0, 2]])
    expect(result.bOnly).toEqual([[2, 4]])
  })
})

describe('versionContainsLV', () => {
  it('直接の祖先を含む', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    expect(versionContainsLV(cg, [4], 0)).toBe(true)
    expect(versionContainsLV(cg, [4], 3)).toBe(true)
    expect(versionContainsLV(cg, [4], 4)).toBe(true)
  })

  it('並行バージョンを含まない', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'A', 1, 2, [0])
    add(cg, 'B', 0, 1, [0])

    // v1(A,1)はv2(B,0)を含まない
    expect(versionContainsLV(cg, [1], 2)).toBe(false)
    // v2(B,0)はv1(A,1)を含まない
    expect(versionContainsLV(cg, [2], 1)).toBe(false)
  })

  it('マージ後は両方を含む', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'A', 1, 2, [0])  // v1
    add(cg, 'B', 0, 1, [0])  // v2
    // マージ: v3は v1とv2の両方を親に持つ
    add(cg, 'A', 2, 3, [1, 2])  // v3

    expect(versionContainsLV(cg, [3], 1)).toBe(true)
    expect(versionContainsLV(cg, [3], 2)).toBe(true)
    expect(versionContainsLV(cg, [3], 0)).toBe(true)
  })
})

describe('findDominators', () => {
  it('空配列は空を返す', () => {
    const cg = createCG()
    expect(findDominators(cg, [])).toEqual([])
  })

  it('単一要素はそのまま返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    expect(findDominators(cg, [0])).toEqual([0])
  })

  it('祖先関係にある場合はドミネーターのみ返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    expect(findDominators(cg, [1, 4])).toEqual([4])
    expect(findDominators(cg, [0, 2, 4])).toEqual([4])
  })

  it('並行バージョンは両方返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'A', 1, 2, [0])  // v1
    add(cg, 'B', 0, 1, [0])  // v2

    const result = findDominators(cg, [1, 2])
    expect(result.sort()).toEqual([1, 2])
  })
})

describe('findConflicting', () => {
  it('直列の場合はvisitで差分が通知される', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    const visited: { range: LVRange; flag: DiffFlag }[] = []
    const ancestor = findConflicting(cg, [2], [4], (range, flag) => {
      visited.push({ range, flag })
    })

    // 直列なので共通祖先はaの位置 [2]
    expect(ancestor).toEqual([2])
  })

  it('並行操作の競合を検出する', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])   // v0: 共通祖先
    add(cg, 'A', 1, 3, [0])  // v1,v2: Aのブランチ
    add(cg, 'B', 0, 2, [0])  // v3,v4: Bのブランチ

    const visited: { range: LVRange; flag: DiffFlag }[] = []
    const ancestor = findConflicting(cg, [2], [4], (range, flag) => {
      visited.push({ range, flag })
    })

    // 共通祖先はv0
    // visitで Aのブランチ([1,3]) と Bのブランチ([3,5]) が通知される
    expect(visited.length).toBeGreaterThan(0)

    // 共通祖先が含まれるはず
    // findConflictingの戻り値はcommonAncestorのバージョン
    expect(ancestor).toEqual([0])
  })
})

describe('compareVersions', () => {
  it('祖先関係を正しく判定する', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    // v0はv4の祖先
    expect(compareVersions(cg, 0, 4)).toBe(1)
    // v4はv0の子孫
    expect(compareVersions(cg, 4, 0)).toBe(-1)
  })

  it('並行バージョンは0を返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'A', 1, 2, [0])
    add(cg, 'B', 0, 1, [0])

    expect(compareVersions(cg, 1, 2)).toBe(0)
  })

  it('等しいバージョンではエラーを投げる', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    expect(() => compareVersions(cg, 0, 0)).toThrow()
  })
})

describe('serializeDiff / mergePartialVersions', () => {
  it('差分をシリアライズしてマージできる', () => {
    const cg1 = createCG()
    add(cg1, 'A', 0, 3, [])
    add(cg1, 'B', 0, 2, [2])

    const cg2 = createCG()
    add(cg2, 'A', 0, 3, [])

    // cg1にあってcg2にないものを取得
    const diffResult = diff(cg1, [2], cg1.heads)
    const serialized = serializeDiff(cg1, diffResult.bOnly)

    // cg2にマージ
    const [start, end] = mergePartialVersions(cg2, serialized)
    expect(start).toBe(3)
    expect(end).toBe(5)
    expect(cg2.heads).toEqual([4])
  })
})

describe('intersectWithSummary', () => {
  it('共通バージョンを計算する', () => {
    const cg1 = createCG()
    add(cg1, 'A', 0, 3, [])
    add(cg1, 'B', 0, 2, [2])

    const cg2 = createCG()
    add(cg2, 'A', 0, 3, [])
    add(cg2, 'C', 0, 1, [2])

    const summary2 = summarizeVersion(cg2)
    const [commonVersion, remainder] = intersectWithSummary(cg1, summary2)

    // 共通バージョンはAの[0,3)
    expect(commonVersion).toEqual([2])
    // cg1にないCの操作が残差
    expect(remainder).not.toBeNull()
    expect(remainder!['C']).toEqual([[0, 1]])
  })
})
