import { bench, describe } from 'vitest'
import * as Y from '../vendor/yjs/dist/yjs.mjs'
import {
  createOpLog,
  localInsert,
  localDelete,
  mergeOplogInto,
  checkoutSimpleString,
  checkout,
  mergeChangesIntoBranch,
  createDocument,
  restoreDocument,
  docInsert,
  getText,
  restoreTextDocument,
  getTextDocText,
} from '../src/index.js'
import type { Branch } from '../src/index.js'
import {
  createOpLog as refCreateOpLog,
  localInsert as refLocalInsert,
  localDelete as refLocalDelete,
  mergeOplogInto as refMergeOplogInto,
  checkoutSimpleString as refCheckoutSimpleString,
} from '../vendor/eg-walker-reference/dist/src/index.js'

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

// --- 小さな文書（1000文字）のベンチマーク ---

describe('逐次挿入（シングルユーザー）: 1000文字を末尾に1文字ずつ追加', () => {
  bench('eg-walker', () => {
    const oplog = createOpLog<string>()
    for (let i = 0; i < 1000; i++) {
      localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    checkoutSimpleString(oplog)
  })

  bench('eg-walker (reference)', () => {
    const oplog = refCreateOpLog<string>()
    for (let i = 0; i < 1000; i++) {
      refLocalInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    for (let i = 0; i < 1000; i++) {
      text.insert(i, String.fromCharCode(97 + (i % 26)))
    }
    text.toString()
  })
})

describe('ランダム位置挿入: 1000文字をランダム位置に挿入', () => {
  bench('eg-walker', () => {
    const rng = createRng(42)
    const oplog = createOpLog<string>()
    for (let i = 0; i < 1000; i++) {
      const pos = Math.floor(rng() * (i + 1))
      localInsert(oplog, 'A', pos, String.fromCharCode(97 + (i % 26)))
    }
    checkoutSimpleString(oplog)
  })

  bench('eg-walker (reference)', () => {
    const rng = createRng(42)
    const oplog = refCreateOpLog<string>()
    for (let i = 0; i < 1000; i++) {
      const pos = Math.floor(rng() * (i + 1))
      refLocalInsert(oplog, 'A', pos, String.fromCharCode(97 + (i % 26)))
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const rng = createRng(42)
    const doc = new Y.Doc()
    const text = doc.getText('t')
    for (let i = 0; i < 1000; i++) {
      const pos = Math.floor(rng() * (i + 1))
      text.insert(pos, String.fromCharCode(97 + (i % 26)))
    }
    text.toString()
  })
})

describe('並行編集+マージ: 2ユーザーがそれぞれ500文字挿入後マージ', () => {
  bench('eg-walker', () => {
    const oplogA = createOpLog<string>()
    const oplogB = createOpLog<string>()

    for (let i = 0; i < 500; i++) {
      localInsert(oplogA, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 500; i++) {
      localInsert(oplogB, 'B', i, String.fromCharCode(65 + (i % 26)))
    }

    mergeOplogInto(oplogA, oplogB)
    checkoutSimpleString(oplogA)
  })

  bench('eg-walker (reference)', () => {
    const oplogA = refCreateOpLog<string>()
    const oplogB = refCreateOpLog<string>()

    for (let i = 0; i < 500; i++) {
      refLocalInsert(oplogA, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 500; i++) {
      refLocalInsert(oplogB, 'B', i, String.fromCharCode(65 + (i % 26)))
    }

    refMergeOplogInto(oplogA, oplogB)
    refCheckoutSimpleString(oplogA)
  })

  bench('Yjs', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const textA = docA.getText('t')
    const textB = docB.getText('t')

    for (let i = 0; i < 500; i++) {
      textA.insert(i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 500; i++) {
      textB.insert(i, String.fromCharCode(65 + (i % 26)))
    }

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))
    textA.toString()
  })
})

describe('挿入+削除の混合: 500文字挿入後、250文字をランダム削除', () => {
  bench('eg-walker', () => {
    const rng = createRng(123)
    const oplog = createOpLog<string>()

    for (let i = 0; i < 500; i++) {
      localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    let length = 500
    for (let i = 0; i < 250; i++) {
      const pos = Math.floor(rng() * length)
      localDelete(oplog, 'A', pos)
      length--
    }
    checkoutSimpleString(oplog)
  })

  bench('eg-walker (reference)', () => {
    const rng = createRng(123)
    const oplog = refCreateOpLog<string>()

    for (let i = 0; i < 500; i++) {
      refLocalInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    let length = 500
    for (let i = 0; i < 250; i++) {
      const pos = Math.floor(rng() * length)
      refLocalDelete(oplog, 'A', pos)
      length--
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const rng = createRng(123)
    const doc = new Y.Doc()
    const text = doc.getText('t')

    for (let i = 0; i < 500; i++) {
      text.insert(i, String.fromCharCode(97 + (i % 26)))
    }
    let length = 500
    for (let i = 0; i < 250; i++) {
      const pos = Math.floor(rng() * length)
      text.delete(pos, 1)
      length--
    }
    text.toString()
  })
})

// --- 大きな文書に対するベンチマーク ---

const LARGE_DOC_SIZE = 10000

// eg-walker用: 事前構築済み大文書のOpLog
function buildLargeEgWalkerDoc() {
  const oplog = createOpLog<string>()
  for (let i = 0; i < LARGE_DOC_SIZE; i++) {
    localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
  }
  return oplog
}

// eg-walker用: 事前構築済み大文書のOpLog + Branch
function buildLargeEgWalkerBranch() {
  const oplog = createOpLog<string>()
  for (let i = 0; i < LARGE_DOC_SIZE; i++) {
    localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
  }
  const branch = checkout(oplog)
  return { oplog, branch }
}

// リファレンス用: 事前構築済み大文書のOpLog
function buildLargeRefDoc() {
  const oplog = refCreateOpLog<string>()
  for (let i = 0; i < LARGE_DOC_SIZE; i++) {
    refLocalInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
  }
  return oplog
}

// Yjs用: 事前構築済み大文書のエンコード済み状態
function buildLargeYjsState() {
  const doc = new Y.Doc()
  const text = doc.getText('t')
  for (let i = 0; i < LARGE_DOC_SIZE; i++) {
    text.insert(i, String.fromCharCode(97 + (i % 26)))
  }
  return Y.encodeStateAsUpdate(doc)
}

describe(`大文書(${LARGE_DOC_SIZE}文字)構築: 末尾に1文字ずつ追加`, () => {
  bench('eg-walker', () => {
    const oplog = createOpLog<string>()
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    checkoutSimpleString(oplog)
  })

  bench('eg-walker (reference)', () => {
    const oplog = refCreateOpLog<string>()
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      refLocalInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      text.insert(i, String.fromCharCode(97 + (i % 26)))
    }
    text.toString()
  })
})

describe(`大文書(${LARGE_DOC_SIZE}文字)に対するランダム挿入100回`, () => {
  const { oplog: baseOplogForBranch, branch: baseBranch } = buildLargeEgWalkerBranch()
  const baseRefOplog = buildLargeRefDoc()
  const yjsState = buildLargeYjsState()

  bench('eg-walker', () => {
    const rng = createRng(77)
    const oplog = createOpLog<string>()
    mergeOplogInto(oplog, baseOplogForBranch)
    const branch: Branch<string> = {
      snapshot: baseBranch.snapshot.slice(),
      version: baseBranch.version.slice(),
    }
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * (LARGE_DOC_SIZE + i + 1))
      localInsert(oplog, 'B', pos, String.fromCharCode(65 + (i % 26)))
    }
    mergeChangesIntoBranch(branch, oplog)
    branch.snapshot.join('')
  })

  bench('eg-walker (reference)', () => {
    const rng = createRng(77)
    const oplog = refCreateOpLog<string>()
    refMergeOplogInto(oplog, baseRefOplog)
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * (LARGE_DOC_SIZE + i + 1))
      refLocalInsert(oplog, 'B', pos, String.fromCharCode(65 + (i % 26)))
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const rng = createRng(77)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjsState)
    const text = doc.getText('t')
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * (LARGE_DOC_SIZE + i + 1))
      text.insert(pos, String.fromCharCode(65 + (i % 26)))
    }
    text.toString()
  })
})

describe(`大文書(${LARGE_DOC_SIZE}文字)に対するランダム削除100回`, () => {
  const { oplog: baseOplogForBranch, branch: baseBranch } = buildLargeEgWalkerBranch()
  const baseRefOplog = buildLargeRefDoc()
  const yjsState = buildLargeYjsState()

  bench('eg-walker', () => {
    const rng = createRng(88)
    const oplog = createOpLog<string>()
    mergeOplogInto(oplog, baseOplogForBranch)
    const branch: Branch<string> = {
      snapshot: baseBranch.snapshot.slice(),
      version: baseBranch.version.slice(),
    }
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * length)
      localDelete(oplog, 'B', pos)
      length--
    }
    mergeChangesIntoBranch(branch, oplog)
    branch.snapshot.join('')
  })

  bench('eg-walker (reference)', () => {
    const rng = createRng(88)
    const oplog = refCreateOpLog<string>()
    refMergeOplogInto(oplog, baseRefOplog)
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * length)
      refLocalDelete(oplog, 'B', pos)
      length--
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const rng = createRng(88)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjsState)
    const text = doc.getText('t')
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 100; i++) {
      const pos = Math.floor(rng() * length)
      text.delete(pos, 1)
      length--
    }
    text.toString()
  })
})

describe(`大文書(${LARGE_DOC_SIZE}文字)に対する挿入+削除の混合200回`, () => {
  const { oplog: baseOplogForBranch, branch: baseBranch } = buildLargeEgWalkerBranch()
  const baseRefOplog = buildLargeRefDoc()
  const yjsState = buildLargeYjsState()

  bench('eg-walker', () => {
    const rng = createRng(99)
    const oplog = createOpLog<string>()
    mergeOplogInto(oplog, baseOplogForBranch)
    const branch: Branch<string> = {
      snapshot: baseBranch.snapshot.slice(),
      version: baseBranch.version.slice(),
    }
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 200; i++) {
      if (rng() < 0.5) {
        const pos = Math.floor(rng() * (length + 1))
        localInsert(oplog, 'B', pos, String.fromCharCode(65 + (i % 26)))
        length++
      } else {
        const pos = Math.floor(rng() * length)
        localDelete(oplog, 'B', pos)
        length--
      }
    }
    mergeChangesIntoBranch(branch, oplog)
    branch.snapshot.join('')
  })

  bench('eg-walker (reference)', () => {
    const rng = createRng(99)
    const oplog = refCreateOpLog<string>()
    refMergeOplogInto(oplog, baseRefOplog)
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 200; i++) {
      if (rng() < 0.5) {
        const pos = Math.floor(rng() * (length + 1))
        refLocalInsert(oplog, 'B', pos, String.fromCharCode(65 + (i % 26)))
        length++
      } else {
        const pos = Math.floor(rng() * length)
        refLocalDelete(oplog, 'B', pos)
        length--
      }
    }
    refCheckoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const rng = createRng(99)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjsState)
    const text = doc.getText('t')
    let length = LARGE_DOC_SIZE
    for (let i = 0; i < 200; i++) {
      if (rng() < 0.5) {
        const pos = Math.floor(rng() * (length + 1))
        text.insert(pos, String.fromCharCode(65 + (i % 26)))
        length++
      } else {
        const pos = Math.floor(rng() * length)
        text.delete(pos, 1)
        length--
      }
    }
    text.toString()
  })
})

describe(`大文書(${LARGE_DOC_SIZE}文字)の並行編集+マージ`, () => {
  const { oplog: baseOplogForBranch, branch: baseBranch } = buildLargeEgWalkerBranch()
  const baseRefOplog = buildLargeRefDoc()
  const yjsState = buildLargeYjsState()

  bench('eg-walker', () => {
    const oplogA = createOpLog<string>()
    mergeOplogInto(oplogA, baseOplogForBranch)
    const oplogB = createOpLog<string>()
    mergeOplogInto(oplogB, baseOplogForBranch)
    const branch: Branch<string> = {
      snapshot: baseBranch.snapshot.slice(),
      version: baseBranch.version.slice(),
    }

    for (let i = 0; i < 100; i++) {
      localInsert(oplogA, 'A', LARGE_DOC_SIZE + i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 100; i++) {
      localInsert(oplogB, 'B', LARGE_DOC_SIZE + i, String.fromCharCode(65 + (i % 26)))
    }

    mergeOplogInto(oplogA, oplogB)
    mergeChangesIntoBranch(branch, oplogA)
    branch.snapshot.join('')
  })

  bench('eg-walker (reference)', () => {
    const oplogA = refCreateOpLog<string>()
    refMergeOplogInto(oplogA, baseRefOplog)
    const oplogB = refCreateOpLog<string>()
    refMergeOplogInto(oplogB, baseRefOplog)

    for (let i = 0; i < 100; i++) {
      refLocalInsert(oplogA, 'A', LARGE_DOC_SIZE + i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 100; i++) {
      refLocalInsert(oplogB, 'B', LARGE_DOC_SIZE + i, String.fromCharCode(65 + (i % 26)))
    }

    refMergeOplogInto(oplogA, oplogB)
    refCheckoutSimpleString(oplogA)
  })

  bench('Yjs', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    Y.applyUpdate(docA, yjsState)
    Y.applyUpdate(docB, yjsState)
    const textA = docA.getText('t')
    const textB = docB.getText('t')

    for (let i = 0; i < 100; i++) {
      textA.insert(LARGE_DOC_SIZE + i, String.fromCharCode(97 + (i % 26)))
    }
    for (let i = 0; i < 100; i++) {
      textB.insert(LARGE_DOC_SIZE + i, String.fromCharCode(65 + (i % 26)))
    }

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))
    textA.toString()
  })
})

// --- ドキュメントオープンのベンチマーク ---
// eg-walkerの真の強み: スナップショットをキャッシュしておけば、復元は配列コピーだけ
// 従来CRDT(Yjs): エンコード済み状態のデシリアライズが必要

describe(`ドキュメントオープン（公正な比較）: ${LARGE_DOC_SIZE}文字`, () => {
  // 事前にキャッシュを構築済み（測定外）
  const baseOplog = buildLargeEgWalkerDoc()
  const baseBranch = checkout(baseOplog)
  // 実際のアプリではディスクにプレーンテキストとしてキャッシュされる
  const cachedSnapshot = baseBranch.snapshot
  const cachedVersion = baseBranch.version
  const cachedText = baseBranch.snapshot.join('')
  const yjsState = buildLargeYjsState()

  bench('eg-walker: キャッシュからの復元 (restoreDocument)', () => {
    // 配列コピー + 文字列化のコスト
    const doc = restoreDocument(baseOplog, cachedSnapshot, cachedVersion)
    getText(doc)
  })

  bench('eg-walker: キャッシュからの復元 (restoreTextDocument)', () => {
    // 文字列をそのまま保持するだけ
    const doc = restoreTextDocument(baseOplog, cachedText, cachedVersion)
    getTextDocText(doc)
  })

  bench('eg-walker: フルリプレイ (checkout)', () => {
    checkoutSimpleString(baseOplog)
  })

  bench('Yjs: applyUpdate + toString', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjsState)
    doc.getText('t').toString()
  })
})

const VERY_LARGE_DOC_SIZE = 50000

function buildVeryLargeEgWalkerDoc() {
  const oplog = createOpLog<string>()
  for (let i = 0; i < VERY_LARGE_DOC_SIZE; i++) {
    localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
  }
  return oplog
}

function buildVeryLargeYjsState() {
  const doc = new Y.Doc()
  const text = doc.getText('t')
  for (let i = 0; i < VERY_LARGE_DOC_SIZE; i++) {
    text.insert(i, String.fromCharCode(97 + (i % 26)))
  }
  return Y.encodeStateAsUpdate(doc)
}

describe(`ドキュメントオープン（公正な比較）: ${VERY_LARGE_DOC_SIZE}文字`, () => {
  const baseOplog = buildVeryLargeEgWalkerDoc()
  const baseBranch = checkout(baseOplog)
  const cachedSnapshot = baseBranch.snapshot
  const cachedVersion = baseBranch.version
  const cachedText = baseBranch.snapshot.join('')
  const yjsState = buildVeryLargeYjsState()

  bench('eg-walker: キャッシュからの復元 (restoreDocument)', () => {
    const doc = restoreDocument(baseOplog, cachedSnapshot, cachedVersion)
    getText(doc)
  })

  bench('eg-walker: キャッシュからの復元 (restoreTextDocument)', () => {
    const doc = restoreTextDocument(baseOplog, cachedText, cachedVersion)
    getTextDocText(doc)
  })

  bench('eg-walker: フルリプレイ (checkout)', () => {
    checkoutSimpleString(baseOplog)
  })

  bench('Yjs: applyUpdate + toString', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjsState)
    doc.getText('t').toString()
  })
})

// --- Document APIでのローカル編集ベンチマーク ---
// docInsertは毎回スナップショットを直接更新するため、最後のgetText()は即座に返る

describe(`Document APIでのローカル編集: ${LARGE_DOC_SIZE}文字構築`, () => {
  bench('eg-walker Document (docInsert)', () => {
    const doc = createDocument<string>()
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      docInsert(doc, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    getText(doc)
  })

  bench('eg-walker 従来API (localInsert + checkout)', () => {
    const oplog = createOpLog<string>()
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
    }
    checkoutSimpleString(oplog)
  })

  bench('Yjs', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    for (let i = 0; i < LARGE_DOC_SIZE; i++) {
      text.insert(i, String.fromCharCode(97 + (i % 26)))
    }
    text.toString()
  })
})
