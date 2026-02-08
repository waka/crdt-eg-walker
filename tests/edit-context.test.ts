import { describe, it, expect } from 'vitest'
import { createOpLog, localInsert, localDelete } from '../src/oplog.js'
import { traverseAndApply, createEditContext } from '../src/edit-context.js'
import { wrapArray } from '../src/snapshot-ops.js'

describe('traverseAndApply', () => {
  it('単純な挿入を適用する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot.join('')).toBe('hello')
  })

  it('挿入と削除の組み合わせ', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 1, 2) // 'e', 'l' を削除
    localInsert(oplog, 'A', 1, 'a')

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot.join('')).toBe('halo')
  })

  it('空の操作ログでは空スナップショット', () => {
    const oplog = createOpLog<string>()

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot).toEqual([])
  })

  it('先頭への挿入', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'b')
    localInsert(oplog, 'A', 0, 'a')

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot.join('')).toBe('ab')
  })

  it('末尾の削除', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')
    localDelete(oplog, 'A', 2) // 'c' を削除

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot.join('')).toBe('ab')
  })

  it('全削除', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    localDelete(oplog, 'A', 0, 2) // 全て削除

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    traverseAndApply(ctx, oplog, wrapArray(snapshot))

    expect(snapshot.join('')).toBe('')
  })

  it('部分範囲の適用', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c', 'd')

    const ctx = createEditContext(oplog.ops.length)
    const snapshot: string[] = []
    // 最初の2操作のみ適用
    traverseAndApply(ctx, oplog, wrapArray(snapshot), 0, 2)

    expect(snapshot.join('')).toBe('ab')
  })
})
