import { describe, it, expect } from 'vitest'
import { createOpLog, localInsert, localDelete, mergeOplogInto } from '../src/oplog.js'
import {
  checkout,
  checkoutSimple,
  checkoutSimpleString,
  createEmptyBranch,
  mergeChangesIntoBranch,
} from '../src/branch.js'

describe('checkout', () => {
  it('単純な挿入でcheckoutする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const branch = checkout(oplog)
    expect(branch.snapshot.join('')).toBe('hello')
    expect(branch.version).toEqual([4])
  })

  it('挿入と削除でcheckoutする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 1, 3) // 'e','l','l'を削除
    localInsert(oplog, 'A', 1, 'i')

    expect(checkoutSimpleString(oplog)).toBe('hio')
  })
})

describe('checkoutSimple / checkoutSimpleString', () => {
  it('配列を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')

    expect(checkoutSimple(oplog)).toEqual(['a', 'b'])
  })

  it('文字列を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    expect(checkoutSimpleString(oplog)).toBe('abc')
  })
})

describe('mergeChangesIntoBranch', () => {
  it('空ブランチに変更をマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const branch = createEmptyBranch<string>()
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('hi')
    expect(branch.version).toEqual([1])
  })

  it('既存ブランチに追加変更をマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const branch = checkout(oplog)
    expect(branch.snapshot.join('')).toBe('hi')

    // 追加操作
    localInsert(oplog, 'A', 2, '!')
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('hi!')
  })
})

describe('mergeChangesIntoBranch (fast-forward)', () => {
  it('複数の挿入をfast-forwardでマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    const branch = checkout(oplog)
    expect(branch.snapshot.join('')).toBe('abc')

    // fast-forward可能な追加挿入
    localInsert(oplog, 'A', 3, 'd', 'e', 'f')
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('abcdef')
    expect(branch.version).toEqual(oplog.cg.heads)
  })

  it('中間位置への挿入をfast-forwardでマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'c')

    const branch = checkout(oplog)

    // 中間位置に挿入
    localInsert(oplog, 'A', 1, 'b')
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('abc')
  })

  it('削除をfast-forwardでマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c', 'd')

    const branch = checkout(oplog)

    // 中間の文字を削除
    localDelete(oplog, 'A', 1) // 'b'を削除
    localDelete(oplog, 'A', 1) // 'c'を削除（'b'削除後のインデックス）
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('ad')
  })

  it('挿入と削除の混合をfast-forwardでマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const branch = checkout(oplog)

    // 削除して挿入
    localDelete(oplog, 'A', 1, 3) // 'e','l','l'を削除
    localInsert(oplog, 'A', 1, 'i')
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe('hio')
  })

  it('fast-forwardの結果がcheckout（フルリプレイ）と一致する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const branch = checkout(oplog)

    // 様々な操作を追加
    localInsert(oplog, 'A', 5, ' ', 'w', 'o', 'r', 'l', 'd')
    localDelete(oplog, 'A', 0) // 'h'を削除
    localInsert(oplog, 'A', 0, 'H')

    mergeChangesIntoBranch(branch, oplog)

    // フルリプレイと比較
    const fullReplay = checkoutSimpleString(oplog)
    expect(branch.snapshot.join('')).toBe(fullReplay)
  })

  it('大きめの文書でfast-forwardの結果がcheckoutと一致する', () => {
    const oplog = createOpLog<string>()
    for (let i = 0; i < 100; i++) {
      localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }

    const branch = checkout(oplog)

    // ランダム位置への挿入・削除を追加
    localInsert(oplog, 'A', 50, 'X', 'Y', 'Z')
    localDelete(oplog, 'A', 10)
    localDelete(oplog, 'A', 20)
    localInsert(oplog, 'A', 0, '!')

    mergeChangesIntoBranch(branch, oplog)

    const fullReplay = checkoutSimpleString(oplog)
    expect(branch.snapshot.join('')).toBe(fullReplay)
    expect(branch.version).toEqual(oplog.cg.heads)
  })

  it('並行操作がある場合は通常パスにフォールバックする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')

    const branch = checkout(oplog)

    // 並行操作を追加（AとBが同時に挿入）
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)
    localInsert(oplogB, 'B', 2, 'Y')
    mergeOplogInto(oplog, oplogB)

    localInsert(oplog, 'A', 2, 'X')
    mergeChangesIntoBranch(branch, oplog)

    // フルリプレイと比較（通常パスでも正しい結果）
    const fullReplay = checkoutSimpleString(oplog)
    expect(branch.snapshot.join('')).toBe(fullReplay)
  })

  it('同じバージョンでmergeしても変化しない', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    const branch = checkout(oplog)
    const snapshotBefore = branch.snapshot.join('')

    // 同じバージョンでmerge（noop）
    mergeChangesIntoBranch(branch, oplog)

    expect(branch.snapshot.join('')).toBe(snapshotBefore)
  })
})
