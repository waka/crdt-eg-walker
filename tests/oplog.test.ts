import { describe, it, expect } from 'vitest'
import {
  createOpLog,
  localInsert,
  localDelete,
  pushOp,
  getLatestVersion,
  mergeOplogInto,
} from '../src/oplog.js'

describe('createOpLog', () => {
  it('空のOpLogを作成する', () => {
    const oplog = createOpLog()
    expect(oplog.ops).toEqual([])
    expect(oplog.cg.heads).toEqual([])
  })
})

describe('localInsert', () => {
  it('挿入操作を記録する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    expect(oplog.ops.length).toBe(5)
    expect(oplog.ops[0]).toEqual({ type: 'ins', pos: 0, content: 'h' })
    expect(oplog.ops[1]).toEqual({ type: 'ins', pos: 1, content: 'e' })
    expect(oplog.ops[4]).toEqual({ type: 'ins', pos: 4, content: 'o' })
    expect(oplog.cg.heads).toEqual([4])
  })

  it('連続挿入で位置が自動インクリメントされる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    localInsert(oplog, 'A', 2, 'c')

    expect(oplog.ops.length).toBe(3)
    expect(oplog.ops[2]).toEqual({ type: 'ins', pos: 2, content: 'c' })
  })
})

describe('localDelete', () => {
  it('削除操作を記録する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 1, 2)

    expect(oplog.ops.length).toBe(7)
    expect(oplog.ops[5]).toEqual({ type: 'del', pos: 1 })
    expect(oplog.ops[6]).toEqual({ type: 'del', pos: 1 })
  })

  it('長さ0の削除はエラーを投げる', () => {
    const oplog = createOpLog<string>()
    expect(() => localDelete(oplog, 'A', 0, 0)).toThrow()
  })
})

describe('pushOp', () => {
  it('外部操作を追加できる', () => {
    const oplog = createOpLog<string>()
    const result = pushOp(oplog, ['A', 0], [], 'ins', 0, 'h')

    expect(result).toBe(true)
    expect(oplog.ops.length).toBe(1)
    expect(oplog.ops[0]).toEqual({ type: 'ins', pos: 0, content: 'h' })
  })

  it('既存操作は追加されずfalseを返す', () => {
    const oplog = createOpLog<string>()
    pushOp(oplog, ['A', 0], [], 'ins', 0, 'h')
    const result = pushOp(oplog, ['A', 0], [], 'ins', 0, 'h')

    expect(result).toBe(false)
    expect(oplog.ops.length).toBe(1)
  })

  it('挿入操作にコンテンツがないとエラー', () => {
    const oplog = createOpLog<string>()
    expect(() => pushOp(oplog, ['A', 0], [], 'ins', 0)).toThrow()
  })
})

describe('getLatestVersion', () => {
  it('最新バージョンを取得する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e')

    const version = getLatestVersion(oplog)
    expect(version).toEqual([['A', 1]])
  })
})

describe('mergeOplogInto', () => {
  it('2つのOpLogをマージする', () => {
    const oplog1 = createOpLog<string>()
    localInsert(oplog1, 'A', 0, 'h', 'e', 'l')

    const oplog2 = createOpLog<string>()
    localInsert(oplog2, 'B', 0, 'w', 'o')

    mergeOplogInto(oplog1, oplog2)

    expect(oplog1.ops.length).toBe(5)
    expect(oplog1.cg.heads.length).toBe(2)
  })

  it('共通の操作がある場合は重複しない', () => {
    const oplog1 = createOpLog<string>()
    localInsert(oplog1, 'A', 0, 'h', 'e')

    const oplog2 = createOpLog<string>()
    // oplog1と同じ操作を追加
    pushOp(oplog2, ['A', 0], [], 'ins', 0, 'h')
    pushOp(oplog2, ['A', 1], [['A', 0]], 'ins', 1, 'e')
    // oplog2にだけある追加操作
    pushOp(oplog2, ['B', 0], [['A', 1]], 'ins', 2, 'y')

    mergeOplogInto(oplog1, oplog2)

    expect(oplog1.ops.length).toBe(3)
    expect(oplog1.ops[2]).toEqual({ type: 'ins', pos: 2, content: 'y' })
  })
})
