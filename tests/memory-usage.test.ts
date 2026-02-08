/**
 * メモリ使用量の比較テスト
 *
 * eg-walkerの特長: OpLogのみ保持し、CRDTメタデータ（tombstone等）を常駐させない
 * 従来CRDT(Yjs)の弱点: 全操作のItem構造体をメモリに保持し続ける
 *
 * process.memoryUsage()ベースの概算。GCタイミングに依存するため
 * 精密な値ではないが、桁の違いは確認できる。
 * より正確な測定には node --expose-gc で実行すること。
 */

import { describe, it, expect } from 'vitest'
import * as Y from '../vendor/yjs/dist/yjs.mjs'
import {
  createOpLog,
  localInsert,
  localDelete,
} from '../src/index.js'

// GCが使える場合は使う（node --expose-gc で起動時）
const tryGC = () => {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

/**
 * 関数内で構築したオブジェクトのヒープ使用量を概算する。
 * 戻り値のオブジェクトを保持することでGCを防ぐ。
 *
 * 注意: ウォームアップは行わない（前のfn()の結果がGCされて
 * 差分が負になる問題を回避するため）。
 */
function measureHeapDelta<T>(fn: () => T): { result: T; heapBytes: number } {
  // 前のゴミを回収して安定させる
  tryGC()
  tryGC()

  const before = process.memoryUsage().heapUsed
  const result = fn()
  // resultが保持されているので、fn()で作ったメインオブジェクトはGCされない
  tryGC()
  tryGC()
  const after = process.memoryUsage().heapUsed

  return { result, heapBytes: after - before }
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return `(GC影響で測定不能)`
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function printComparison(label: string, egBytes: number, yjsBytes: number) {
  console.log(`\n  [${label}]`)
  console.log(`  eg-walker OpLog: ${formatBytes(egBytes)}`)
  console.log(`  Yjs Doc:         ${formatBytes(yjsBytes)}`)
  if (egBytes > 0 && yjsBytes > 0) {
    console.log(`  比率: Yjs/eg-walker = ${(yjsBytes / egBytes).toFixed(2)}x`)
  } else {
    console.log(`  比率: 測定不安定 (--expose-gc での実行を推奨)`)
  }
}

describe('メモリ使用量比較: 10,000文字', () => {
  const DOC_SIZE = 10000

  it(`${DOC_SIZE}文字の逐次挿入: OpLog vs Yjs Doc`, () => {
    const eg = measureHeapDelta(() => {
      const oplog = createOpLog<string>()
      for (let i = 0; i < DOC_SIZE; i++) {
        localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
      }
      return oplog
    })

    const yjs = measureHeapDelta(() => {
      const doc = new Y.Doc()
      const text = doc.getText('t')
      for (let i = 0; i < DOC_SIZE; i++) {
        text.insert(i, String.fromCharCode(97 + (i % 26)))
      }
      return doc
    })

    printComparison(`${DOC_SIZE}文字 逐次挿入`, eg.heapBytes, yjs.heapBytes)
    expect(eg.result).toBeDefined()
    expect(yjs.result).toBeDefined()
  })

  it(`${DOC_SIZE}文字の挿入+50%削除 (tombstoneあり): OpLog vs Yjs Doc`, () => {
    const eg = measureHeapDelta(() => {
      const oplog = createOpLog<string>()
      for (let i = 0; i < DOC_SIZE; i++) {
        localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
      }
      let length = DOC_SIZE
      for (let i = 0; i < DOC_SIZE / 2; i++) {
        localDelete(oplog, 'A', i % length)
        length--
      }
      return oplog
    })

    const yjs = measureHeapDelta(() => {
      const doc = new Y.Doc()
      const text = doc.getText('t')
      for (let i = 0; i < DOC_SIZE; i++) {
        text.insert(i, String.fromCharCode(97 + (i % 26)))
      }
      let length = DOC_SIZE
      for (let i = 0; i < DOC_SIZE / 2; i++) {
        text.delete(i % length, 1)
        length--
      }
      return doc
    })

    printComparison(
      `${DOC_SIZE}文字 挿入+50%削除 (tombstoneあり)`,
      eg.heapBytes,
      yjs.heapBytes,
    )
    expect(eg.result).toBeDefined()
    expect(yjs.result).toBeDefined()
  })
})

describe('メモリ使用量比較: 50,000文字', () => {
  const DOC_SIZE = 50000

  it(`${DOC_SIZE}文字の逐次挿入: OpLog vs Yjs Doc`, () => {
    const eg = measureHeapDelta(() => {
      const oplog = createOpLog<string>()
      for (let i = 0; i < DOC_SIZE; i++) {
        localInsert(oplog, 'A', i, String.fromCharCode(97 + (i % 26)))
      }
      return oplog
    })

    const yjs = measureHeapDelta(() => {
      const doc = new Y.Doc()
      const text = doc.getText('t')
      for (let i = 0; i < DOC_SIZE; i++) {
        text.insert(i, String.fromCharCode(97 + (i % 26)))
      }
      return doc
    })

    printComparison(`${DOC_SIZE}文字 逐次挿入`, eg.heapBytes, yjs.heapBytes)
    expect(eg.result).toBeDefined()
    expect(yjs.result).toBeDefined()
  })
})
