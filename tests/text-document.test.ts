import { describe, it, expect } from 'vitest'
import {
  createTextDocument,
  openTextDocument,
  restoreTextDocument,
  textDocInsert,
  textDocDelete,
  getTextDocText,
  mergeTextRemote,
  createOpLog,
  localInsert,
  localDelete,
  mergeOplogInto,
  checkoutSimpleString,
} from '../src/index.js'

// 再現可能な疑似乱数生成器（xorshift32）
function createRng(seed: number) {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return (state >>> 0) / 0xffffffff
  }
}

describe('createTextDocument', () => {
  it('空のテキストドキュメントを作成する', () => {
    const doc = createTextDocument()
    expect(getTextDocText(doc)).toBe('')
    expect(doc.oplog.ops).toHaveLength(0)
    expect(doc.version).toEqual([])
  })
})

describe('textDocInsert', () => {
  it('挿入がtextとoplogの両方に反映される', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'hello')
    expect(getTextDocText(doc)).toBe('hello')
    expect(doc.oplog.ops).toHaveLength(5)
    expect(doc.version).toHaveLength(1)
  })

  it('連続挿入で正しく動作する', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'a')
    textDocInsert(doc, 'A', 1, 'b')
    textDocInsert(doc, 'A', 2, 'c')
    expect(getTextDocText(doc)).toBe('abc')
  })

  it('中間位置への挿入', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'ac')
    textDocInsert(doc, 'A', 1, 'b')
    expect(getTextDocText(doc)).toBe('abc')
  })

  it('先頭への挿入', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'b')
    textDocInsert(doc, 'A', 0, 'a')
    expect(getTextDocText(doc)).toBe('ab')
  })

  it('複数文字を一度に挿入できる', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'hello world')
    expect(getTextDocText(doc)).toBe('hello world')
    expect(doc.oplog.ops).toHaveLength(11)
  })
})

describe('textDocDelete', () => {
  it('削除がtextとoplogの両方に反映される', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'abc')
    textDocDelete(doc, 'A', 1)
    expect(getTextDocText(doc)).toBe('ac')
    expect(doc.oplog.ops).toHaveLength(4)
  })

  it('複数文字の削除', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'abcd')
    textDocDelete(doc, 'A', 1, 2)
    expect(getTextDocText(doc)).toBe('ad')
  })

  it('先頭の削除', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'abc')
    textDocDelete(doc, 'A', 0)
    expect(getTextDocText(doc)).toBe('bc')
  })

  it('末尾の削除', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'abc')
    textDocDelete(doc, 'A', 2)
    expect(getTextDocText(doc)).toBe('ab')
  })
})

describe('一貫性: TextDocument操作とcheckoutの結果が一致する', () => {
  it('挿入のみの場合', () => {
    const doc = createTextDocument()
    const oplog = createOpLog<string>()

    textDocInsert(doc, 'A', 0, 'hello')
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    textDocInsert(doc, 'A', 5, ' world')
    localInsert(oplog, 'A', 5, ' ', 'w', 'o', 'r', 'l', 'd')

    expect(getTextDocText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('挿入+削除の混合', () => {
    const doc = createTextDocument()
    const oplog = createOpLog<string>()

    textDocInsert(doc, 'A', 0, 'abcde')
    localInsert(oplog, 'A', 0, 'a', 'b', 'c', 'd', 'e')

    textDocDelete(doc, 'A', 1, 2)
    localDelete(oplog, 'A', 1, 2)

    textDocInsert(doc, 'A', 1, 'XY')
    localInsert(oplog, 'A', 1, 'X', 'Y')

    expect(getTextDocText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('ランダム操作100回で一致', () => {
    const rng = createRng(42)
    const doc = createTextDocument()
    const oplog = createOpLog<string>()
    let length = 0

    for (let i = 0; i < 100; i++) {
      if (length === 0 || rng() < 0.6) {
        // 挿入
        const pos = Math.floor(rng() * (length + 1))
        const ch = String.fromCharCode(97 + (i % 26))
        textDocInsert(doc, 'A', pos, ch)
        localInsert(oplog, 'A', pos, ch)
        length++
      } else {
        // 削除
        const pos = Math.floor(rng() * length)
        textDocDelete(doc, 'A', pos)
        localDelete(oplog, 'A', pos)
        length--
      }
    }

    expect(getTextDocText(doc)).toBe(checkoutSimpleString(oplog))
    expect(getTextDocText(doc)).toHaveLength(length)
  })
})

describe('openTextDocument', () => {
  it('OpLogからフルリプレイでドキュメントを開く', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 4)
    localInsert(oplog, 'A', 4, '!')

    const doc = openTextDocument(oplog)
    expect(getTextDocText(doc)).toBe('hell!')
    expect(getTextDocText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('開いたドキュメントに追加編集ができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const doc = openTextDocument(oplog)
    textDocInsert(doc, 'A', 2, '!')

    expect(getTextDocText(doc)).toBe('hi!')
  })

  it('空のOpLogから開ける', () => {
    const oplog = createOpLog<string>()
    const doc = openTextDocument(oplog)
    expect(getTextDocText(doc)).toBe('')
  })
})

describe('restoreTextDocument', () => {
  it('キャッシュからドキュメントを復元する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const text = checkoutSimpleString(oplog)
    const doc = restoreTextDocument(oplog, text, oplog.cg.heads.slice())

    expect(getTextDocText(doc)).toBe('hello')
  })

  it('復元後に追加編集ができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const text = checkoutSimpleString(oplog)
    const doc = restoreTextDocument(oplog, text, oplog.cg.heads.slice())
    textDocInsert(doc, 'A', 2, '!')

    expect(getTextDocText(doc)).toBe('hi!')
  })

  it('復元後にリモートマージができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const text = checkoutSimpleString(oplog)
    const doc = restoreTextDocument(oplog, text, oplog.cg.heads.slice())

    // リモートのOpLog
    const remoteOplog = createOpLog<string>()
    mergeOplogInto(remoteOplog, oplog)
    localInsert(remoteOplog, 'B', 2, '!')

    mergeTextRemote(doc, remoteOplog)
    expect(getTextDocText(doc)).toBe('hi!')
  })

  it('渡したversion配列を変更しても元のDocumentに影響しない', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    const text = checkoutSimpleString(oplog)

    const version = oplog.cg.heads.slice()
    const doc = restoreTextDocument(oplog, text, version)

    // 渡した配列を変更
    version.push(999)

    // Documentには影響しない
    expect(getTextDocText(doc)).toBe('ab')
    expect(doc.version).not.toContain(999)
  })
})

describe('mergeTextRemote', () => {
  it('リモートのOpLogをマージしてテキストが更新される', () => {
    const docA = createTextDocument()
    textDocInsert(docA, 'A', 0, 'hello')

    const docB = createTextDocument()
    textDocInsert(docB, 'B', 0, 'world')

    mergeTextRemote(docA, docB.oplog)

    const result = getTextDocText(docA)
    expect(result).toContain('hello')
    expect(result).toContain('world')
    expect(result.length).toBe(10)
  })

  it('マージ後にさらにローカル編集ができる', () => {
    const docA = createTextDocument()
    textDocInsert(docA, 'A', 0, 'a')

    const docB = createTextDocument()
    textDocInsert(docB, 'B', 0, 'b')

    mergeTextRemote(docA, docB.oplog)
    const lengthAfterMerge = getTextDocText(docA).length
    textDocInsert(docA, 'A', lengthAfterMerge, '!')

    expect(getTextDocText(docA)).toContain('!')
  })

  it('双方向マージで収束する', () => {
    const docA = createTextDocument()
    textDocInsert(docA, 'A', 0, 'hello')

    const docB = createTextDocument()
    textDocInsert(docB, 'B', 0, 'world')

    mergeTextRemote(docA, docB.oplog)
    mergeTextRemote(docB, docA.oplog)

    expect(getTextDocText(docA)).toBe(getTextDocText(docB))
  })

  it('共通の祖先を持つ並行編集のマージ', () => {
    // 共通の初期状態
    const base = createOpLog<string>()
    localInsert(base, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    // 2つのドキュメントに分岐
    const docA = openTextDocument(createOpLog<string>())
    mergeTextRemote(docA, base)
    const docB = openTextDocument(createOpLog<string>())
    mergeTextRemote(docB, base)

    // 並行に編集
    textDocInsert(docA, 'A', 5, '!')
    textDocInsert(docB, 'B', 0, '>')

    // マージ
    mergeTextRemote(docA, docB.oplog)
    mergeTextRemote(docB, docA.oplog)

    expect(getTextDocText(docA)).toBe(getTextDocText(docB))
    expect(getTextDocText(docA)).toContain('hello')
    expect(getTextDocText(docA)).toContain('!')
    expect(getTextDocText(docA)).toContain('>')
  })
})

describe('getTextDocText', () => {
  it('テキストを即座に返す', () => {
    const doc = createTextDocument()
    textDocInsert(doc, 'A', 0, 'abc')
    expect(getTextDocText(doc)).toBe('abc')
  })

  it('空ドキュメントの場合', () => {
    const doc = createTextDocument()
    expect(getTextDocText(doc)).toBe('')
  })
})

describe('Document APIとの一貫性', () => {
  it('同じ操作を実行した結果がDocument APIと一致する', () => {
    const rng = createRng(12345)
    const doc = createTextDocument()
    const oplog = createOpLog<string>()
    let length = 0

    for (let i = 0; i < 200; i++) {
      if (length === 0 || rng() < 0.6) {
        const pos = Math.floor(rng() * (length + 1))
        const ch = String.fromCharCode(97 + (i % 26))
        textDocInsert(doc, 'A', pos, ch)
        localInsert(oplog, 'A', pos, ch)
        length++
      } else {
        const pos = Math.floor(rng() * length)
        textDocDelete(doc, 'A', pos)
        localDelete(oplog, 'A', pos)
        length--
      }
    }

    expect(getTextDocText(doc)).toBe(checkoutSimpleString(oplog))
  })
})
