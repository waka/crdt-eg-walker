/**
 * テキスト特化のドキュメント実装
 *
 * スナップショットを string で直接保持し、getText を即座に返せるようにする。
 * Document<string> の T[] (string[]) による join('') のボトルネックを解消する。
 *
 * Document と同様に mutable パターン（内部変更・void返却）を採用。
 */

import { localInsert, localDelete, createOpLog, mergeOplogInto } from './oplog.js'
import { checkoutSimpleString } from './branch.js'
import { diff, findDominators } from './causal-graph-advanced.js'
import { canFastForward } from './document.js'
import type { LV, ListOpLog } from './types.js'

/** テキスト特化ドキュメント（スナップショットを string で保持） */
export interface TextDocument {
  readonly oplog: ListOpLog<string>
  readonly text: string
  readonly version: LV[]
}

/** 内部でプロパティを更新するためのキャスト */
type MutableTextDocument = { -readonly [K in keyof TextDocument]: TextDocument[K] }

/** 空のテキストドキュメントを作成 */
export function createTextDocument(): TextDocument {
  return {
    oplog: createOpLog<string>(),
    text: '',
    version: [],
  }
}

/**
 * OpLogからフルリプレイでテキストドキュメントを開く。
 * キャッシュがない場合のフォールバック。
 */
export function openTextDocument(oplog: ListOpLog<string>): TextDocument {
  const text = oplog.ops.length === 0 ? '' : checkoutSimpleString(oplog)
  return {
    oplog,
    text,
    version: oplog.cg.heads.slice(),
  }
}

/**
 * キャッシュ済みテキストからドキュメントを即時復元。
 * eg-walkerの真の強み: 文字列をそのまま保持するだけで開ける。
 */
export function restoreTextDocument(
  oplog: ListOpLog<string>,
  text: string,
  version: LV[],
): TextDocument {
  return {
    oplog,
    text,
    version: version.slice(),
  }
}

/**
 * ローカル挿入。
 * OpLogとテキストの両方を直接更新する。
 */
export function textDocInsert(
  doc: TextDocument,
  agent: string,
  pos: number,
  content: string,
): void {
  localInsert(doc.oplog, agent, pos, ...content.split(''))
  const mut = doc as MutableTextDocument
  mut.text = doc.text.slice(0, pos) + content + doc.text.slice(pos)
  mut.version = doc.oplog.cg.heads.slice()
}

/**
 * ローカル削除。
 * OpLogとテキストの両方を直接更新する。
 */
export function textDocDelete(
  doc: TextDocument,
  agent: string,
  pos: number,
  len: number = 1,
): void {
  localDelete(doc.oplog, agent, pos, len)
  const mut = doc as MutableTextDocument
  mut.text = doc.text.slice(0, pos) + doc.text.slice(pos + len)
  mut.version = doc.oplog.cg.heads.slice()
}

/** テキスト取得（即座に返す） */
export function getTextDocText(doc: TextDocument): string {
  return doc.text
}

/**
 * リモートのOpLogをマージ。
 *
 * fast-forward可能ならdiffの操作をstring slicingで適用。
 * 並行編集がある場合はフルリプレイで正確な収束を保証。
 */
export function mergeTextRemote(
  doc: TextDocument,
  remoteOplog: ListOpLog<string>,
): void {
  mergeOplogInto(doc.oplog, remoteOplog)
  const heads = doc.oplog.cg.heads
  const mut = doc as MutableTextDocument

  if (canFastForward(doc.oplog.cg, doc.version, heads)) {
    // fast-forward: diffの操作をstring slicingで適用
    const ranges = diff(doc.oplog.cg, doc.version, heads).bOnly
    let text = doc.text
    for (const [start, end] of ranges) {
      for (let lv = start; lv < end; lv++) {
        const op = doc.oplog.ops[lv]!
        if (op.type === 'ins') {
          text = text.slice(0, op.pos) + op.content + text.slice(op.pos)
        } else {
          text = text.slice(0, op.pos) + text.slice(op.pos + 1)
        }
      }
    }
    mut.text = text
    mut.version = findDominators(doc.oplog.cg, [...doc.version, ...heads])
  } else {
    // 並行編集あり: フルリプレイで正確な収束を保証
    mut.text = checkoutSimpleString(doc.oplog)
    mut.version = doc.oplog.cg.heads.slice()
  }
}
