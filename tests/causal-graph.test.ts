import { describe, it, expect } from 'vitest'
import {
  createCG,
  add,
  addRaw,
  nextLV,
  nextSeqForAgent,
  lvToRaw,
  rawToLV,
  rawToLVList,
  findEntryContaining,
  advanceFrontier,
  iterVersionsBetween,
  summarizeVersion,
  lvEq,
  hasVersion,
  lvCmp,
} from '../src/causal-graph.js'

describe('createCG', () => {
  it('空の因果グラフを作成する', () => {
    const cg = createCG()
    expect(cg.heads).toEqual([])
    expect(cg.entries).toEqual([])
    expect(cg.agentToVersion.size).toBe(0)
  })
})

describe('add / addRaw', () => {
  it('単一エントリを追加する', () => {
    const cg = createCG()
    const entry = add(cg, 'A', 0, 1, [])
    expect(entry).not.toBeNull()
    expect(entry!.version).toBe(0)
    expect(entry!.vEnd).toBe(1)
    expect(entry!.agent).toBe('A')
    expect(entry!.seq).toBe(0)
    expect(cg.heads).toEqual([0])
  })

  it('連続したエントリがRLE圧縮される', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'A', 1, 2, [0])
    add(cg, 'A', 2, 3, [1])

    // RLE圧縮で1つのエントリになる
    expect(cg.entries.length).toBe(1)
    expect(cg.entries[0]!.version).toBe(0)
    expect(cg.entries[0]!.vEnd).toBe(3)
    expect(cg.heads).toEqual([2])
  })

  it('異なるエージェントからの追加は別エントリになる', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    add(cg, 'B', 0, 1, [0])

    expect(cg.entries.length).toBe(2)
    expect(cg.heads).toEqual([1])
  })

  it('並行操作でheadsに複数バージョンが残る', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    // AとBがv0を共通の親として並行に操作
    add(cg, 'A', 1, 2, [0])
    add(cg, 'B', 0, 1, [0])

    expect(cg.heads).toEqual([1, 2])
  })

  it('既に存在するエントリを追加するとnullを返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])
    const result = add(cg, 'A', 0, 3, [])
    expect(result).toBeNull()
  })

  it('addRawでRawVersionベースの親を指定できる', () => {
    const cg = createCG()
    addRaw(cg, ['A', 0], 1)
    addRaw(cg, ['B', 0], 1, [['A', 0]])

    expect(cg.heads).toEqual([1])
    expect(cg.entries.length).toBe(2)
  })
})

describe('nextLV / nextSeqForAgent', () => {
  it('空のCGでは0を返す', () => {
    const cg = createCG()
    expect(nextLV(cg)).toBe(0)
    expect(nextSeqForAgent(cg, 'A')).toBe(0)
  })

  it('追加後は正しい値を返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])
    expect(nextLV(cg)).toBe(3)
    expect(nextSeqForAgent(cg, 'A')).toBe(3)
    expect(nextSeqForAgent(cg, 'B')).toBe(0)
  })
})

describe('lvToRaw / rawToLV', () => {
  it('LVとRawVersionを相互変換できる', () => {
    const cg = createCG()
    // A: seq 0,1,2 → LV 0,1,2
    add(cg, 'A', 0, 3, [])
    // B: seq 0,1 → LV 3,4 (親はLV2=A,2)
    add(cg, 'B', 0, 2, [2])

    expect(lvToRaw(cg, 0)).toEqual(['A', 0])
    expect(lvToRaw(cg, 1)).toEqual(['A', 1])
    expect(lvToRaw(cg, 2)).toEqual(['A', 2])
    expect(lvToRaw(cg, 3)).toEqual(['B', 0])
    expect(lvToRaw(cg, 4)).toEqual(['B', 1])

    expect(rawToLV(cg, 'A', 0)).toBe(0)
    expect(rawToLV(cg, 'A', 2)).toBe(2)
    expect(rawToLV(cg, 'B', 0)).toBe(3)
    expect(rawToLV(cg, 'B', 1)).toBe(4)
  })

  it('存在しないRawVersionでエラーを投げる', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    expect(() => rawToLV(cg, 'B', 0)).toThrow()
  })
})

describe('rawToLVList', () => {
  it('RawVersionリストをLVリストに変換する', () => {
    const cg = createCG()
    add(cg, 'A', 0, 2, [])
    add(cg, 'B', 0, 1, [1])

    const result = rawToLVList(cg, [['A', 1], ['B', 0]])
    expect(result).toEqual([1, 2])
  })
})

describe('findEntryContaining', () => {
  it('LVを含むエントリとオフセットを返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    const [entry, offset] = findEntryContaining(cg, 0)
    expect(entry.agent).toBe('A')
    expect(offset).toBe(0)

    const [entry2, offset2] = findEntryContaining(cg, 3)
    expect(entry2.agent).toBe('A')
    expect(offset2).toBe(3)
  })

  it('存在しないLVでエラーを投げる', () => {
    const cg = createCG()
    add(cg, 'A', 0, 1, [])
    expect(() => findEntryContaining(cg, 5)).toThrow()
  })
})

describe('advanceFrontier', () => {
  it('初期状態からフロンティアを進める', () => {
    const result = advanceFrontier([], 0, [])
    expect(result).toEqual([0])
  })

  it('親を消費して新しいバージョンを追加する', () => {
    const result = advanceFrontier([0], 1, [0])
    expect(result).toEqual([1])
  })

  it('並行操作でフロンティアに複数バージョンが残る', () => {
    let frontier = advanceFrontier([], 0, [])
    frontier = advanceFrontier(frontier, 1, [0])
    frontier = advanceFrontier(frontier, 2, [0])
    expect(frontier).toEqual([1, 2])
  })
})

describe('iterVersionsBetween', () => {
  it('バージョン範囲のエントリをイテレートする', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])
    add(cg, 'B', 0, 3, [4])

    const entries = [...iterVersionsBetween(cg, 0, 8)]
    expect(entries.length).toBe(2)
    expect(entries[0]!.agent).toBe('A')
    expect(entries[0]!.version).toBe(0)
    expect(entries[0]!.vEnd).toBe(5)
    expect(entries[1]!.agent).toBe('B')
    expect(entries[1]!.version).toBe(5)
    expect(entries[1]!.vEnd).toBe(8)
  })

  it('部分範囲をスライスして返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 10, [])

    const entries = [...iterVersionsBetween(cg, 3, 7)]
    expect(entries.length).toBe(1)
    expect(entries[0]!.version).toBe(3)
    expect(entries[0]!.vEnd).toBe(7)
    expect(entries[0]!.seq).toBe(3)
    expect(entries[0]!.parents).toEqual([2])
  })

  it('空範囲では何もyieldしない', () => {
    const cg = createCG()
    add(cg, 'A', 0, 5, [])

    const entries = [...iterVersionsBetween(cg, 3, 3)]
    expect(entries.length).toBe(0)
  })
})

describe('summarizeVersion', () => {
  it('バージョンサマリを生成する', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])
    add(cg, 'B', 0, 2, [2])

    const summary = summarizeVersion(cg)
    expect(summary.get('A')).toEqual([[0, 3]])
    expect(summary.get('B')).toEqual([[0, 2]])
  })
})

describe('lvEq', () => {
  it('同じバージョン配列はtrueを返す', () => {
    expect(lvEq([0, 1, 2], [0, 1, 2])).toBe(true)
    expect(lvEq([], [])).toBe(true)
  })

  it('異なるバージョン配列はfalseを返す', () => {
    expect(lvEq([0, 1], [0, 2])).toBe(false)
    expect(lvEq([0], [0, 1])).toBe(false)
  })
})

describe('hasVersion', () => {
  it('既知のバージョンにtrueを返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])
    expect(hasVersion(cg, 'A', 0)).toBe(true)
    expect(hasVersion(cg, 'A', 2)).toBe(true)
  })

  it('未知のバージョンにfalseを返す', () => {
    const cg = createCG()
    add(cg, 'A', 0, 3, [])
    expect(hasVersion(cg, 'A', 3)).toBe(false)
    expect(hasVersion(cg, 'B', 0)).toBe(false)
  })
})

describe('lvCmp', () => {
  it('RawVersionベースで比較する', () => {
    const cg = createCG()
    add(cg, 'A', 0, 2, [])
    add(cg, 'B', 0, 2, [1])

    // A,0 vs A,1 → 0-1 = -1
    expect(lvCmp(cg, 0, 1)).toBeLessThan(0)
    // A,0 vs B,0 → 'A' < 'B' = -1
    expect(lvCmp(cg, 0, 2)).toBeLessThan(0)
    // B,0 vs A,0 → 'B' > 'A' = 1
    expect(lvCmp(cg, 2, 0)).toBeGreaterThan(0)
  })
})
