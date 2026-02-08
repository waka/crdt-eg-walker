import { describe, it, expect } from 'vitest'
import {
  createOpLog,
  localInsert,
  localDelete,
  pushOp,
  mergeOplogInto,
  checkout,
  checkoutSimpleString,
  mergeChangesIntoBranch,
} from '../src/index.js'

describe('統合テスト: 2ユーザー並行編集', () => {
  it('2ユーザーが独立に挿入 → マージ後に同一結果', () => {
    // ユーザーAのOpLog
    const oplogA = createOpLog<string>()
    localInsert(oplogA, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    // ユーザーBのOpLog
    const oplogB = createOpLog<string>()
    localInsert(oplogB, 'B', 0, 'w', 'o', 'r', 'l', 'd')

    // AにBをマージ
    mergeOplogInto(oplogA, oplogB)
    const resultA = checkoutSimpleString(oplogA)

    // BにAをマージ
    mergeOplogInto(oplogB, oplogA)
    const resultB = checkoutSimpleString(oplogB)

    // マージ順序に関わらず同一結果（収束性）
    expect(resultA).toBe(resultB)

    // 両方の文字が全て含まれている
    expect(resultA).toContain('h')
    expect(resultA).toContain('e')
    expect(resultA).toContain('l')
    expect(resultA).toContain('o')
    expect(resultA).toContain('w')
    expect(resultA).toContain('r')
    expect(resultA).toContain('d')
    expect(resultA.length).toBe(10)
  })

  it('共通の祖先を持つ2ユーザーの並行編集', () => {
    // 共通の初期状態を作成
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    // AとBにコピー
    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, oplog)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)

    // Aが末尾に' world'を追加
    localInsert(oplogA, 'A', 5, ' ', 'w', 'o', 'r', 'l', 'd')

    // Bが末尾に'!'を追加
    localInsert(oplogB, 'B', 5, '!')

    // マージして収束性を確認
    mergeOplogInto(oplogA, oplogB)
    mergeOplogInto(oplogB, oplogA)

    const resultA = checkoutSimpleString(oplogA)
    const resultB = checkoutSimpleString(oplogB)

    expect(resultA).toBe(resultB)
    expect(resultA).toContain('hello')
    expect(resultA).toContain('!')
    expect(resultA).toContain('world')
  })

  it('2ユーザーが同じ位置に挿入', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'c')

    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, oplog)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)

    // 同じ位置(1)に挿入
    localInsert(oplogA, 'A', 1, 'X')
    localInsert(oplogB, 'B', 1, 'Y')

    mergeOplogInto(oplogA, oplogB)
    mergeOplogInto(oplogB, oplogA)

    const resultA = checkoutSimpleString(oplogA)
    const resultB = checkoutSimpleString(oplogB)

    // 収束性
    expect(resultA).toBe(resultB)
    // 全ての文字が含まれている
    expect(resultA).toContain('a')
    expect(resultA).toContain('X')
    expect(resultA).toContain('Y')
    expect(resultA).toContain('c')
    expect(resultA.length).toBe(4)
  })
})

describe('統合テスト: 挿入と削除の交錯', () => {
  it('一方が挿入し他方が削除する並行操作', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, oplog)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)

    // Aが'b'を削除
    localDelete(oplogA, 'A', 1)
    // Bが'b'の後にXを挿入
    localInsert(oplogB, 'B', 2, 'X')

    mergeOplogInto(oplogA, oplogB)
    mergeOplogInto(oplogB, oplogA)

    const resultA = checkoutSimpleString(oplogA)
    const resultB = checkoutSimpleString(oplogB)

    expect(resultA).toBe(resultB)
    // 'b'が削除され、'X'が挿入されている
    expect(resultA).not.toContain('b')
    expect(resultA).toContain('X')
    expect(resultA).toContain('a')
    expect(resultA).toContain('c')
  })

  it('同じ文字を2ユーザーが同時に削除', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, oplog)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)

    // 両方が'b'を削除
    localDelete(oplogA, 'A', 1)
    localDelete(oplogB, 'B', 1)

    mergeOplogInto(oplogA, oplogB)
    mergeOplogInto(oplogB, oplogA)

    const resultA = checkoutSimpleString(oplogA)
    const resultB = checkoutSimpleString(oplogB)

    expect(resultA).toBe(resultB)
    expect(resultA).toBe('ac')
  })
})

describe('統合テスト: 3ユーザーのシナリオ', () => {
  it('3ユーザーが独立に編集してマージ', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'x')

    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, oplog)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplog)
    const oplogC = createOpLog<string>()
    mergeOplogInto(oplogC, oplog)

    // 各ユーザーが独立に編集
    localInsert(oplogA, 'A', 1, 'A')
    localInsert(oplogB, 'B', 1, 'B')
    localInsert(oplogC, 'C', 1, 'C')

    // 全てをoplogAにマージ
    mergeOplogInto(oplogA, oplogB)
    mergeOplogInto(oplogA, oplogC)

    // 全てをoplogBにマージ
    mergeOplogInto(oplogB, oplogA)
    mergeOplogInto(oplogB, oplogC)

    // 全てをoplogCにマージ
    mergeOplogInto(oplogC, oplogA)
    mergeOplogInto(oplogC, oplogB)

    const resultA = checkoutSimpleString(oplogA)
    const resultB = checkoutSimpleString(oplogB)
    const resultC = checkoutSimpleString(oplogC)

    // 全て同一結果
    expect(resultA).toBe(resultB)
    expect(resultB).toBe(resultC)

    // 全ての文字が含まれている
    expect(resultA).toContain('x')
    expect(resultA).toContain('A')
    expect(resultA).toContain('B')
    expect(resultA).toContain('C')
    expect(resultA.length).toBe(4)
  })
})

describe('統合テスト: mergeChangesIntoBranch', () => {
  it('ブランチに新しい変更をマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const branch = checkout(oplog)
    expect(branch.snapshot.join('')).toBe('hello')

    // 追加変更をpushOpで追加
    pushOp(oplog, ['B', 0], [['A', 4]], 'ins', 5, '!')

    mergeChangesIntoBranch(branch, oplog)
    expect(branch.snapshot.join('')).toBe('hello!')
  })

  it('並行変更をブランチにマージする', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')

    const branch = checkout(oplog)

    // 並行に変更を追加
    pushOp(oplog, ['A', 2], [['A', 1]], 'ins', 2, 'X')
    pushOp(oplog, ['B', 0], [['A', 1]], 'ins', 2, 'Y')

    mergeChangesIntoBranch(branch, oplog)

    // 全文字が含まれている
    const result = branch.snapshot.join('')
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('X')
    expect(result).toContain('Y')
    expect(result.length).toBe(4)
  })
})

describe('統合テスト: pushOpによるネットワーク受信シミュレーション', () => {
  it('pushOpで操作を受信しcheckoutする', () => {
    const oplog = createOpLog<string>()

    // ユーザーAの操作をpushOp経由で追加
    pushOp(oplog, ['A', 0], [], 'ins', 0, 'h')
    pushOp(oplog, ['A', 1], [['A', 0]], 'ins', 1, 'i')

    // ユーザーBの操作を並行に追加
    pushOp(oplog, ['B', 0], [], 'ins', 0, 'y')
    pushOp(oplog, ['B', 1], [['B', 0]], 'ins', 1, 'o')

    const result = checkoutSimpleString(oplog)
    expect(result.length).toBe(4)
    expect(result).toContain('h')
    expect(result).toContain('i')
    expect(result).toContain('y')
    expect(result).toContain('o')
  })
})
