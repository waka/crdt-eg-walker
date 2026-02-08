import { describe, it, expect } from 'vitest'
import {
  createDocument,
  openDocument,
  restoreDocument,
  docInsert,
  docDelete,
  getContent,
  getText,
  mergeRemote,
  createOpLog,
  localInsert,
  localDelete,
  mergeOplogInto,
  checkout,
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

describe('createDocument', () => {
  it('空のドキュメントを作成する', () => {
    const doc = createDocument<string>()
    expect(getText(doc)).toBe('')
    expect(getContent(doc)).toEqual([])
    expect(doc.oplog.ops).toHaveLength(0)
    expect(doc.branch.version).toEqual([])
  })
})

describe('docInsert', () => {
  it('挿入がsnapshotとoplogの両方に反映される', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    expect(getText(doc)).toBe('hello')
    expect(doc.oplog.ops).toHaveLength(5)
    expect(doc.branch.version).toHaveLength(1)
  })

  it('連続挿入で正しく動作する', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a')
    docInsert(doc, 'A', 1, 'b')
    docInsert(doc, 'A', 2, 'c')
    expect(getText(doc)).toBe('abc')
  })

  it('中間位置への挿入', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'c')
    docInsert(doc, 'A', 1, 'b')
    expect(getText(doc)).toBe('abc')
  })

  it('先頭への挿入', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'b')
    docInsert(doc, 'A', 0, 'a')
    expect(getText(doc)).toBe('ab')
  })
})

describe('docDelete', () => {
  it('削除がsnapshotとoplogの両方に反映される', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c')
    docDelete(doc, 'A', 1)
    expect(getText(doc)).toBe('ac')
    expect(doc.oplog.ops).toHaveLength(4)
  })

  it('複数文字の削除', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c', 'd')
    docDelete(doc, 'A', 1, 2)
    expect(getText(doc)).toBe('ad')
  })

  it('先頭の削除', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c')
    docDelete(doc, 'A', 0)
    expect(getText(doc)).toBe('bc')
  })

  it('末尾の削除', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c')
    docDelete(doc, 'A', 2)
    expect(getText(doc)).toBe('ab')
  })
})

describe('一貫性: Document操作とcheckoutの結果が一致する', () => {
  it('挿入のみの場合', () => {
    const doc = createDocument<string>()
    const oplog = createOpLog<string>()

    docInsert(doc, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    docInsert(doc, 'A', 5, ' ', 'w', 'o', 'r', 'l', 'd')
    localInsert(oplog, 'A', 5, ' ', 'w', 'o', 'r', 'l', 'd')

    expect(getText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('挿入+削除の混合', () => {
    const doc = createDocument<string>()
    const oplog = createOpLog<string>()

    docInsert(doc, 'A', 0, 'a', 'b', 'c', 'd', 'e')
    localInsert(oplog, 'A', 0, 'a', 'b', 'c', 'd', 'e')

    docDelete(doc, 'A', 1, 2)
    localDelete(oplog, 'A', 1, 2)

    docInsert(doc, 'A', 1, 'X', 'Y')
    localInsert(oplog, 'A', 1, 'X', 'Y')

    expect(getText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('ランダム操作100回で一致', () => {
    const rng = createRng(42)
    const doc = createDocument<string>()
    const oplog = createOpLog<string>()
    let length = 0

    for (let i = 0; i < 100; i++) {
      if (length === 0 || rng() < 0.6) {
        // 挿入
        const pos = Math.floor(rng() * (length + 1))
        const ch = String.fromCharCode(97 + (i % 26))
        docInsert(doc, 'A', pos, ch)
        localInsert(oplog, 'A', pos, ch)
        length++
      } else {
        // 削除
        const pos = Math.floor(rng() * length)
        docDelete(doc, 'A', pos)
        localDelete(oplog, 'A', pos)
        length--
      }
    }

    expect(getText(doc)).toBe(checkoutSimpleString(oplog))
    expect(getContent(doc)).toHaveLength(length)
  })
})

describe('openDocument', () => {
  it('OpLogからフルリプレイでドキュメントを開く', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 4)
    localInsert(oplog, 'A', 4, '!')

    const doc = openDocument(oplog)
    expect(getText(doc)).toBe('hell!')
    expect(getText(doc)).toBe(checkoutSimpleString(oplog))
  })

  it('開いたドキュメントに追加編集ができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const doc = openDocument(oplog)
    docInsert(doc, 'A', 2, '!')

    expect(getText(doc)).toBe('hi!')
  })
})

describe('restoreDocument', () => {
  it('キャッシュからドキュメントを復元する', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const branch = checkout(oplog)
    const doc = restoreDocument(oplog, branch.snapshot, branch.version)

    expect(getText(doc)).toBe('hello')
  })

  it('復元後に追加編集ができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const branch = checkout(oplog)
    const doc = restoreDocument(oplog, branch.snapshot, branch.version)
    docInsert(doc, 'A', 2, '!')

    expect(getText(doc)).toBe('hi!')
  })

  it('復元後にリモートマージができる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')

    const branch = checkout(oplog)
    const doc = restoreDocument(oplog, branch.snapshot, branch.version)

    // リモートのOpLog
    const remoteOplog = createOpLog<string>()
    mergeOplogInto(remoteOplog, oplog)
    localInsert(remoteOplog, 'B', 2, '!')

    mergeRemote(doc, remoteOplog)
    expect(getText(doc)).toBe('hi!')
  })

  it('渡した配列を変更しても元のDocumentに影響しない', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'a', 'b')
    const branch = checkout(oplog)

    const snapshot = branch.snapshot.slice()
    const version = branch.version.slice()
    const doc = restoreDocument(oplog, snapshot, version)

    // 渡した配列を変更
    snapshot.push('x')
    version.push(999)

    // Documentには影響しない
    expect(getText(doc)).toBe('ab')
    expect(doc.branch.version).not.toContain(999)
  })
})

describe('mergeRemote', () => {
  it('リモートのOpLogをマージしてスナップショットが更新される', () => {
    const docA = createDocument<string>()
    docInsert(docA, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const docB = createDocument<string>()
    docInsert(docB, 'B', 0, 'w', 'o', 'r', 'l', 'd')

    mergeRemote(docA, docB.oplog)

    const result = getText(docA)
    expect(result).toContain('hello')
    expect(result).toContain('world')
    expect(result.length).toBe(10)
  })

  it('マージ後にさらにローカル編集ができる', () => {
    const docA = createDocument<string>()
    docInsert(docA, 'A', 0, 'a')

    const docB = createDocument<string>()
    docInsert(docB, 'B', 0, 'b')

    mergeRemote(docA, docB.oplog)
    const lengthAfterMerge = getContent(docA).length
    docInsert(docA, 'A', lengthAfterMerge, '!')

    expect(getText(docA)).toContain('!')
  })

  it('双方向マージで収束する', () => {
    const docA = createDocument<string>()
    docInsert(docA, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const docB = createDocument<string>()
    docInsert(docB, 'B', 0, 'w', 'o', 'r', 'l', 'd')

    mergeRemote(docA, docB.oplog)
    mergeRemote(docB, docA.oplog)

    expect(getText(docA)).toBe(getText(docB))
  })

  it('共通の祖先を持つ並行編集のマージ', () => {
    // 共通の初期状態
    const base = createOpLog<string>()
    localInsert(base, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    // 2つのドキュメントに分岐
    const docA = openDocument(createOpLog<string>())
    mergeRemote(docA, base)
    const docB = openDocument(createOpLog<string>())
    mergeRemote(docB, base)

    // 並行に編集
    docInsert(docA, 'A', 5, '!')
    docInsert(docB, 'B', 0, '>')

    // マージ
    mergeRemote(docA, docB.oplog)
    mergeRemote(docB, docA.oplog)

    expect(getText(docA)).toBe(getText(docB))
    expect(getText(docA)).toContain('hello')
    expect(getText(docA)).toContain('!')
    expect(getText(docA)).toContain('>')
  })
})

describe('getContent / getText', () => {
  it('getContentはスナップショット配列を返す', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c')
    expect(getContent(doc)).toEqual(['a', 'b', 'c'])
  })

  it('getTextは文字列を返す', () => {
    const doc = createDocument<string>()
    docInsert(doc, 'A', 0, 'a', 'b', 'c')
    expect(getText(doc)).toBe('abc')
  })

  it('空ドキュメントの場合', () => {
    const doc = createDocument<string>()
    expect(getText(doc)).toBe('')
    expect(getContent(doc)).toEqual([])
  })
})
