import { describe, it, expect } from 'vitest'
import { createOpLog, localInsert, localDelete } from '../src/oplog.js'
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
