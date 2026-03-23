import { describe, it, expect } from 'vitest'
import { Transaction } from '../src/transaction.js'
import { createOpLog, localInsert, localDelete } from '../src/oplog.js'

describe('Transaction', () => {
  it('空のコールバックは空のグループを返す', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()
    const group = tx.transact(oplog, () => {})
    expect(group).toEqual([0, 0])
  })

  it('単一の挿入操作をグループ化する', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()
    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'a')
    })
    expect(group).toEqual([0, 1])
  })

  it('複数の挿入操作をグループ化する', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()
    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    })
    expect(group).toEqual([0, 5])
  })

  it('挿入 + 削除の混在操作をグループ化する', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()
    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'h', 'i')
      localDelete(oplog, 'A', 0)
    })
    // ins(h)=0, ins(i)=1, del(0)=2
    expect(group).toEqual([0, 3])
  })

  it('既存の操作の後にトランザクションを実行する', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')  // LV 0,1,2

    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 3, 'd', 'e')  // LV 3,4
    })
    expect(group).toEqual([3, 5])
  })

  it('連続したトランザクションは独立したグループを返す', () => {
    const tx = new Transaction()
    const oplog = createOpLog<string>()

    const group1 = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'a', 'b')
    })
    const group2 = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 2, 'c')
    })

    expect(group1).toEqual([0, 2])
    expect(group2).toEqual([2, 3])
  })
})
