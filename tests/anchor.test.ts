import { describe, it, expect } from 'vitest'
import { createOpLog, localInsert, localDelete, mergeOplogInto } from '../src/oplog.js'
import { createEditContext, traverseAndApply } from '../src/edit-context.js'
import { indexToAnchor, anchorToIndex } from '../src/anchor.js'
import type { EditContext } from '../src/types.js'

// EditContext をチェックアウト状態で作成するヘルパー
function buildCtx<T>(oplog: ReturnType<typeof createOpLog<T>>): EditContext {
  const ctx = createEditContext(oplog.ops.length)
  traverseAndApply(ctx, oplog, null)
  return ctx
}

describe('indexToAnchor', () => {
  it('index=0 は start を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    const ctx = buildCtx(oplog)

    expect(indexToAnchor(ctx, 0)).toEqual({ type: 'start' })
  })

  it('負のインデックスは start を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    const ctx = buildCtx(oplog)

    expect(indexToAnchor(ctx, -1)).toEqual({ type: 'start' })
  })

  it('length 以上のインデックスは end を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')
    const ctx = buildCtx(oplog)

    expect(indexToAnchor(ctx, 2)).toEqual({ type: 'end' })
    expect(indexToAnchor(ctx, 99)).toEqual({ type: 'end' })
  })

  it('中間インデックスはそのアイテムの opId を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    // ops: h=0, e=1, l=2, l=3, o=4
    const ctx = buildCtx(oplog)

    // index=1 → 'h' の後ろ → opId=0
    const anchor1 = indexToAnchor(ctx, 1)
    expect(anchor1).toEqual({ type: 'after', opId: 0 })

    // index=5 は end
    const anchor5 = indexToAnchor(ctx, 5)
    expect(anchor5).toEqual({ type: 'end' })
  })
})

describe('anchorToIndex', () => {
  it('start は 0 を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    const ctx = buildCtx(oplog)

    expect(anchorToIndex(ctx, { type: 'start' })).toBe(0)
  })

  it('end は文字列長を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')
    const ctx = buildCtx(oplog)

    expect(anchorToIndex(ctx, { type: 'end' })).toBe(2)
  })

  it('after は対象アイテムの直後インデックスを返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    // h=0, e=1, l=2, l=3, o=4
    const ctx = buildCtx(oplog)

    expect(anchorToIndex(ctx, { type: 'after', opId: 0 })).toBe(1) // 'h' の後ろ
    expect(anchorToIndex(ctx, { type: 'after', opId: 4 })).toBe(5) // 'o' の後ろ
  })

  it('indexToAnchor → anchorToIndex のラウンドトリップ', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    const ctx = buildCtx(oplog)

    for (let i = 0; i <= 5; i++) {
      const anchor = indexToAnchor(ctx, i)
      expect(anchorToIndex(ctx, anchor)).toBe(i)
    }
  })
})

describe('anchorToIndex: 削除フォールバック', () => {
  it('アンカーが削除されたとき originLeft の後ろに移動する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c')
    // a=0, b=1, c=2
    // 'b' (opId=1) を削除
    localDelete(oplog, 'A', 1)

    // 削除前の ctx でアンカーを作成（'b' の直後 = index 2）
    const ctxBefore = buildCtx(createOpLog<string>())
    // 直接 opId=1 のアンカーを作成して削除後の ctx でテスト
    const anchor: ReturnType<typeof indexToAnchor> = { type: 'after', opId: 1 }

    const ctxAfter = buildCtx(oplog)
    // 'b' が削除されたので 'a' の直後（index=1）に移動するはず
    expect(anchorToIndex(ctxAfter, anchor)).toBe(1)
  })

  it('連続して削除されたときも正しく解決される', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b', 'c', 'd')
    // a=0, b=1, c=2, d=3
    // 'b' と 'c' を削除
    localDelete(oplog, 'A', 1, 2)

    // 'c' (opId=2) の直後アンカー
    const anchor: ReturnType<typeof indexToAnchor> = { type: 'after', opId: 2 }
    const ctx = buildCtx(oplog)

    // 'b','c' ともに削除。originLeft を辿ると 'a' (opId=0) → index=1
    expect(anchorToIndex(ctx, anchor)).toBe(1)
  })

  it('先頭文字が削除された場合は 0 を返す', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'x', 'y')
    // x=0, y=1
    localDelete(oplog, 'A', 0)

    // 'x' (opId=0) の直後アンカー
    const anchor: ReturnType<typeof indexToAnchor> = { type: 'after', opId: 0 }
    const ctx = buildCtx(oplog)

    // 'x' は originLeft=-1（先頭）なので 0 を返す
    expect(anchorToIndex(ctx, anchor)).toBe(0)
  })
})

describe('リモート op 適用後のカーソル位置保持', () => {
  it('先頭への挿入でカーソルが後ろにずれる', () => {
    // A が "hello" を書いた後、B が先頭に "say " を挿入する
    const oplogA = createOpLog<string>()
    localInsert(oplogA, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    // h=0, e=1, l=2, l=3, o=4

    const ctxA = buildCtx(oplogA)
    // カーソルを 'hello' の 'o' の後ろ（index=5=末尾）に設定
    const anchor = indexToAnchor(ctxA, 5)

    // B が先頭に挿入
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, oplogA)
    localInsert(oplogB, 'B', 0, 's', 'a', 'y', ' ')
    // say =5,6,7,8

    const ctxMerged = buildCtx(oplogB)
    // マージ後のカーソル: "say hello" の末尾 = 9
    expect(anchorToIndex(ctxMerged, anchor)).toBe(9)
  })
})
