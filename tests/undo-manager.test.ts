import { describe, it, expect } from 'vitest'
import { UndoManager, buildUndoContext } from '../src/undo-manager.js'
import { Transaction } from '../src/transaction.js'
import { createOpLog, localInsert, localDelete } from '../src/oplog.js'
import { checkoutSimpleString } from '../src/branch.js'
import type { ListOp } from '../src/types.js'

// テスト用: 逆op列を oplog に直接適用するコールバック生成
function makeApplyFn(oplog: ReturnType<typeof createOpLog<string>>) {
  return (ops: ListOp<string>[]) => {
    for (const op of ops) {
      if (op.type === 'del') {
        localDelete(oplog, 'A', op.pos)
      } else {
        localInsert(oplog, 'A', op.pos, op.content)
      }
    }
  }
}

describe('UndoManager: 基本', () => {
  it('初期状態では canUndo/canRedo が false', () => {
    const um = new UndoManager<string>('A')
    expect(um.canUndo).toBe(false)
    expect(um.canRedo).toBe(false)
  })

  it('空グループは push しても canUndo が false のまま', () => {
    const um = new UndoManager<string>('A')
    um.push([0, 0])
    expect(um.canUndo).toBe(false)
  })

  it('push 後は canUndo が true', () => {
    const um = new UndoManager<string>('A')
    um.push([0, 3])
    expect(um.canUndo).toBe(true)
    expect(um.canRedo).toBe(false)
  })

  it('undo 後は canRedo が true', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')

    const um = new UndoManager<string>('A')
    um.push([0, 3])

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))

    expect(um.canUndo).toBe(false)
    expect(um.canRedo).toBe(true)
  })

  it('undo でスタックが空なら何も起きない', () => {
    const um = new UndoManager<string>('A')
    const oplog = createOpLog<string>()
    const applied: ListOp<string>[] = []
    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, (ops) => applied.push(...ops))
    expect(applied).toHaveLength(0)
  })

  it('redo でスタックが空なら何も起きない', () => {
    const um = new UndoManager<string>('A')
    const oplog = createOpLog<string>()
    const applied: ListOp<string>[] = []
    const ctx = buildUndoContext(oplog)
    um.redo(ctx, oplog, (ops) => applied.push(...ops))
    expect(applied).toHaveLength(0)
  })
})

describe('UndoManager: push でredoスタックがクリアされる', () => {
  it('undo 後に push するとredoスタックがクリアされる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')

    const um = new UndoManager<string>('A')
    um.push([0, 2])

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(um.canRedo).toBe(true)

    // 新しい操作を push
    localInsert(oplog, 'A', 0, 'x')
    um.push([oplog.ops.length - 1, oplog.ops.length])
    expect(um.canRedo).toBe(false)
  })
})

describe('UndoManager: 挿入のundo', () => {
  it('単一文字の挿入をundoできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')  // LV 0-4
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 5, '!')  // LV 5
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('hello!')

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')
  })

  it('複数文字の挿入をundoできる', () => {
    const oplog = createOpLog<string>()
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'h', 'i')  // LV 0,1
    })
    um.push(group)

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('')
  })

  it('文書の先頭への挿入をundoできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'w', 'o', 'r', 'l', 'd')  // LV 0-4
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o', ' ')  // LV 5-10
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('hello world')

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('world')
  })
})

describe('UndoManager: 削除のundo', () => {
  it('単一文字の削除をundoできる（文字が復元される）', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    // h=0, e=1, l=2, l=3, o=4
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localDelete(oplog, 'A', 2)  // LV 5, targets LV 2 ('l')
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('helo')

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')
  })

  it('先頭文字の削除をundoできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')  // h=0, i=1
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localDelete(oplog, 'A', 0)  // 'h'(LV=0) を削除
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('i')

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hi')
  })

  it('複数文字の削除をundoできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localDelete(oplog, 'A', 1, 2)  // 'e','l' を削除
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('hlo')

    const ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')
  })
})

describe('UndoManager: undo/redo ラウンドトリップ', () => {
  it('挿入の undo → redo で元の文書に戻る', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localInsert(oplog, 'A', 5, '!')
    })
    um.push(group)
    expect(checkoutSimpleString(oplog)).toBe('hello!')

    // undo
    let ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')

    // redo: '!' が復元される
    ctx = buildUndoContext(oplog)
    um.redo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello!')
  })

  it('削除の undo → redo で元の状態に戻る', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    const group = tx.transact(oplog, () => {
      localDelete(oplog, 'A', 1)  // 'b' を削除
    })
    um.push(group)

    expect(checkoutSimpleString(oplog)).toBe('ac')

    // undo: 'b' が復元される
    let ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('abc')

    // redo: 'b' が再削除される
    ctx = buildUndoContext(oplog)
    um.redo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('ac')
  })

  it('undo → redo → undo の繰り返しで正しい状態が維持される', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    um.push(tx.transact(oplog, () => localInsert(oplog, 'A', 5, '!')))
    expect(checkoutSimpleString(oplog)).toBe('hello!')

    let ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')

    ctx = buildUndoContext(oplog)
    um.redo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello!')

    ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('hello')
  })

  it('複数回の undo が LIFO 順で動作する', () => {
    const oplog = createOpLog<string>()
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    um.push(tx.transact(oplog, () => localInsert(oplog, 'A', 0, 'a')))
    um.push(tx.transact(oplog, () => localInsert(oplog, 'A', 1, 'b')))
    um.push(tx.transact(oplog, () => localInsert(oplog, 'A', 2, 'c')))

    expect(checkoutSimpleString(oplog)).toBe('abc')

    // 最後の 'c' からundoされる
    let ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('ab')

    ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('a')

    ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('')

    expect(um.canUndo).toBe(false)
  })
})

describe('UndoManager: Transaction との連携', () => {
  it('トランザクション単位でundoできる（IMEシミュレーション）', () => {
    const oplog = createOpLog<string>()
    const tx = new Transaction()
    const um = new UndoManager<string>('A')

    // 単独キーストローク 'a' (個別トランザクション)
    um.push(tx.transact(oplog, () => localInsert(oplog, 'A', 0, 'a')))

    // IME変換: "bc" をひとつのトランザクションで挿入
    um.push(tx.transact(oplog, () => {
      localInsert(oplog, 'A', 1, 'b')
      localInsert(oplog, 'A', 2, 'c')
    }))

    expect(checkoutSimpleString(oplog)).toBe('abc')

    // 最後の IME トランザクション('bc')を一括 undo
    let ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('a')

    // 次の undo で 'a' も消える
    ctx = buildUndoContext(oplog)
    um.undo(ctx, oplog, makeApplyFn(oplog))
    expect(checkoutSimpleString(oplog)).toBe('')
  })
})
