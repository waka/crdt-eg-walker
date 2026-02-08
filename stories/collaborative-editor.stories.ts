/**
 * 協調編集デモストーリー
 *
 * 2人のユーザーがそれぞれ独立に編集し、マージで結果が収束することを確認する。
 */

import type { Meta, StoryObj } from '@storybook/html-vite'
import type { ListOpLog } from '../src/types.js'
import { createOpLog, localInsert, localDelete, mergeOplogInto } from '../src/oplog.js'
import { checkoutSimpleString } from '../src/branch.js'

// --- スタイル定義 ---

const STYLES = `
  .demo-container {
    font-family: system-ui, -apple-system, sans-serif;
    max-width: 900px;
    margin: 24px auto;
    padding: 24px;
  }
  .editors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 24px;
  }
  .editor-panel {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 16px;
    background: #fafafa;
  }
  .editor-panel h3 {
    margin: 0 0 12px;
    color: #333;
  }
  .editor-panel textarea {
    width: 100%;
    height: 120px;
    font-family: monospace;
    font-size: 14px;
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    resize: vertical;
    box-sizing: border-box;
  }
  .op-log {
    margin-top: 12px;
    padding: 8px;
    background: #f0f0f0;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    max-height: 150px;
    overflow-y: auto;
  }
  .op-log-title {
    font-weight: bold;
    margin-bottom: 4px;
    color: #666;
  }
  .op-entry { color: #444; }
  .op-entry.ins { color: #2d7d2d; }
  .op-entry.del { color: #c33; }
  .merge-section {
    text-align: center;
    margin-bottom: 24px;
  }
  .merge-btn {
    padding: 12px 32px;
    font-size: 16px;
    background: #4a90d9;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .merge-btn:hover { background: #357abd; }
  .merge-btn:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .result-section {
    border: 2px solid #4a90d9;
    border-radius: 8px;
    padding: 16px;
    background: #f0f6ff;
  }
  .result-section h3 {
    margin: 0 0 8px;
    color: #333;
  }
  .result-text {
    font-family: monospace;
    font-size: 16px;
    padding: 12px;
    background: white;
    border-radius: 4px;
    border: 1px solid #ddd;
    min-height: 24px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .result-stats {
    margin-top: 8px;
    font-size: 13px;
    color: #666;
  }
  .preset-notice {
    background: #fffde7;
    border: 1px solid #ffd54f;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 16px;
    font-size: 14px;
    color: #6d5f00;
  }
`

// --- ユーティリティ ---

/** OpLogの操作数を返す */
function opCount(oplog: ListOpLog<string>): number {
  return oplog.ops.length
}

/** 操作ログのHTML表現を生成 */
function formatOpLog(oplog: ListOpLog<string>): string {
  if (oplog.ops.length === 0) return '<div class="op-entry">（操作なし）</div>'
  return oplog.ops
    .map((op, i) => {
      if (op.type === 'ins') {
        return `<div class="op-entry ins">#${i} ins pos=${op.pos} "${op.content}"</div>`
      }
      return `<div class="op-entry del">#${i} del pos=${op.pos}</div>`
    })
    .join('')
}

// --- テキスト差分をOpLog操作に変換 ---

/**
 * textareaの前回値と現在値の差分を計算し、OpLog操作として記録する。
 * 簡易的な差分: 先頭と末尾の一致部分を見つけて、中間の変更を挿入/削除に変換する。
 */
function applyDiffToOpLog(
  oplog: ListOpLog<string>,
  agent: string,
  oldText: string,
  newText: string,
): void {
  if (oldText === newText) return

  // 先頭の一致部分を見つける
  let prefixLen = 0
  while (
    prefixLen < oldText.length &&
    prefixLen < newText.length &&
    oldText[prefixLen] === newText[prefixLen]
  ) {
    prefixLen++
  }

  // 末尾の一致部分を見つける（先頭の一致部分とオーバーラップしない）
  let suffixLen = 0
  while (
    suffixLen < oldText.length - prefixLen &&
    suffixLen < newText.length - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const deleteCount = oldText.length - prefixLen - suffixLen
  const insertChars = newText.slice(prefixLen, newText.length - suffixLen)

  // 削除を先に実行
  if (deleteCount > 0) {
    localDelete(oplog, agent, prefixLen, deleteCount)
  }

  // 挿入
  if (insertChars.length > 0) {
    localInsert(oplog, agent, prefixLen, ...insertChars.split(''))
  }
}

// --- ストーリー定義 ---

interface DemoArgs {
  /** プリセットモード: 自動実行するシナリオ名 */
  preset?: 'concurrent-insert' | 'insert-and-delete'
}

const meta: Meta<DemoArgs> = {
  title: '協調編集デモ',
}

export default meta

type Story = StoryObj<DemoArgs>

/** デモUIを構築する共通関数 */
function createDemoUI(args: DemoArgs): HTMLElement {
  const container = document.createElement('div')

  // スタイル注入
  const style = document.createElement('style')
  style.textContent = STYLES
  container.appendChild(style)

  const wrapper = document.createElement('div')
  wrapper.className = 'demo-container'
  container.appendChild(wrapper)

  // 状態管理
  let oplogA = createOpLog<string>()
  let oplogB = createOpLog<string>()
  let prevTextA = ''
  let prevTextB = ''

  // プリセットの場合は通知を表示
  if (args.preset) {
    const notice = document.createElement('div')
    notice.className = 'preset-notice'
    notice.textContent =
      args.preset === 'concurrent-insert'
        ? 'プリセット: 同じ位置への同時挿入シナリオ。自動実行後の結果を表示しています。'
        : 'プリセット: 一方が挿入、他方が削除するシナリオ。自動実行後の結果を表示しています。'
    wrapper.appendChild(notice)
  }

  // エディタパネル
  const editors = document.createElement('div')
  editors.className = 'editors'
  wrapper.appendChild(editors)

  // ユーザーA
  const panelA = document.createElement('div')
  panelA.className = 'editor-panel'
  panelA.innerHTML = `
    <h3>ユーザーA</h3>
    <textarea id="textarea-a" placeholder="ここにテキストを入力..."></textarea>
    <div class="op-log">
      <div class="op-log-title">操作ログ</div>
      <div id="oplog-a">（操作なし）</div>
    </div>
  `
  editors.appendChild(panelA)

  // ユーザーB
  const panelB = document.createElement('div')
  panelB.className = 'editor-panel'
  panelB.innerHTML = `
    <h3>ユーザーB</h3>
    <textarea id="textarea-b" placeholder="ここにテキストを入力..."></textarea>
    <div class="op-log">
      <div class="op-log-title">操作ログ</div>
      <div id="oplog-b">（操作なし）</div>
    </div>
  `
  editors.appendChild(panelB)

  // マージセクション
  const mergeSection = document.createElement('div')
  mergeSection.className = 'merge-section'
  mergeSection.innerHTML = '<button class="merge-btn" id="merge-btn">マージ実行</button>'
  wrapper.appendChild(mergeSection)

  // 結果セクション
  const resultSection = document.createElement('div')
  resultSection.className = 'result-section'
  resultSection.innerHTML = `
    <h3>マージ結果</h3>
    <div class="result-text" id="result-text">（マージ未実行）</div>
    <div class="result-stats" id="result-stats"></div>
  `
  wrapper.appendChild(resultSection)

  // DOM要素の参照を取得（containerがDOMに追加された後に実行）
  const setup = () => {
    const textareaA = container.querySelector<HTMLTextAreaElement>('#textarea-a')!
    const textareaB = container.querySelector<HTMLTextAreaElement>('#textarea-b')!
    const oplogAEl = container.querySelector<HTMLElement>('#oplog-a')!
    const oplogBEl = container.querySelector<HTMLElement>('#oplog-b')!
    const mergeBtn = container.querySelector<HTMLButtonElement>('#merge-btn')!
    const resultText = container.querySelector<HTMLElement>('#result-text')!
    const resultStats = container.querySelector<HTMLElement>('#result-stats')!

    // テキスト入力のイベントハンドラ
    textareaA.addEventListener('input', () => {
      const newText = textareaA.value
      applyDiffToOpLog(oplogA, 'A', prevTextA, newText)
      prevTextA = newText
      oplogAEl.innerHTML = formatOpLog(oplogA)
    })

    textareaB.addEventListener('input', () => {
      const newText = textareaB.value
      applyDiffToOpLog(oplogB, 'B', prevTextB, newText)
      prevTextB = newText
      oplogBEl.innerHTML = formatOpLog(oplogB)
    })

    // マージボタン
    mergeBtn.addEventListener('click', () => {
      // マージ用にOpLogをコピー（AにBをマージ）
      const merged = createOpLog<string>()

      // Aの操作を再現
      for (const op of oplogA.ops) {
        if (op.type === 'ins') {
          localInsert(merged, 'A', op.pos, op.content)
        } else {
          localDelete(merged, 'A', op.pos)
        }
      }

      // Bの操作用のOpLogを作成
      const oplogBCopy = createOpLog<string>()
      for (const op of oplogB.ops) {
        if (op.type === 'ins') {
          localInsert(oplogBCopy, 'B', op.pos, op.content)
        } else {
          localDelete(oplogBCopy, 'B', op.pos)
        }
      }

      // マージ
      mergeOplogInto(merged, oplogBCopy)

      const result = checkoutSimpleString(merged)
      resultText.textContent = result || '（空文字列）'
      resultStats.textContent = `操作数: A=${opCount(oplogA)}, B=${opCount(oplogB)} → マージ後合計=${merged.ops.length}`
    })

    // プリセットシナリオの実行
    if (args.preset === 'concurrent-insert') {
      runConcurrentInsertPreset(
        textareaA, textareaB, oplogAEl, oplogBEl, resultText, resultStats,
      )
    } else if (args.preset === 'insert-and-delete') {
      runInsertAndDeletePreset(
        textareaA, textareaB, oplogAEl, oplogBEl, resultText, resultStats,
      )
    }
  }

  // プリセット: 同時挿入
  function runConcurrentInsertPreset(
    textareaA: HTMLTextAreaElement,
    textareaB: HTMLTextAreaElement,
    oplogAEl: HTMLElement,
    oplogBEl: HTMLElement,
    resultText: HTMLElement,
    resultStats: HTMLElement,
  ) {
    // OpLogをリセット
    oplogA = createOpLog<string>()
    oplogB = createOpLog<string>()

    // Aが "Hello" を入力
    localInsert(oplogA, 'A', 0, ...'Hello'.split(''))
    textareaA.value = 'Hello'
    prevTextA = 'Hello'

    // Bも同じ位置に "World" を入力
    localInsert(oplogB, 'B', 0, ...'World'.split(''))
    textareaB.value = 'World'
    prevTextB = 'World'

    // ログ更新
    oplogAEl.innerHTML = formatOpLog(oplogA)
    oplogBEl.innerHTML = formatOpLog(oplogB)

    // マージ実行
    const merged = createOpLog<string>()
    localInsert(merged, 'A', 0, ...'Hello'.split(''))
    const bOnly = createOpLog<string>()
    localInsert(bOnly, 'B', 0, ...'World'.split(''))
    mergeOplogInto(merged, bOnly)

    const result = checkoutSimpleString(merged)
    resultText.textContent = result || '（空文字列）'
    resultStats.textContent = `操作数: A=${opCount(oplogA)}, B=${opCount(oplogB)} → マージ後合計=${merged.ops.length}`
  }

  // プリセット: 挿入と削除
  function runInsertAndDeletePreset(
    textareaA: HTMLTextAreaElement,
    textareaB: HTMLTextAreaElement,
    oplogAEl: HTMLElement,
    oplogBEl: HTMLElement,
    resultText: HTMLElement,
    resultStats: HTMLElement,
  ) {
    // 共通の初期テキストを持つOpLogを作成
    const base = createOpLog<string>()
    localInsert(base, 'base', 0, ...'Hello World'.split(''))

    // AとBで同じ初期状態を共有
    oplogA = createOpLog<string>()
    localInsert(oplogA, 'base', 0, ...'Hello World'.split(''))
    oplogB = createOpLog<string>()
    localInsert(oplogB, 'base', 0, ...'Hello World'.split(''))

    // AがマージしてBの初期状態を取得
    mergeOplogInto(oplogA, oplogB)
    // BがマージしてAの初期状態を取得
    mergeOplogInto(oplogB, oplogA)

    // Aが末尾に "!" を追加
    localInsert(oplogA, 'A', 11, '!')
    textareaA.value = 'Hello World!'
    prevTextA = 'Hello World!'

    // Bが "World" を削除 (位置6から5文字)
    localDelete(oplogB, 'B', 6, 5)
    textareaB.value = 'Hello '
    prevTextB = 'Hello '

    // ログ更新
    oplogAEl.innerHTML = formatOpLog(oplogA)
    oplogBEl.innerHTML = formatOpLog(oplogB)

    // マージ実行
    const merged = createOpLog<string>()
    // Aの全操作をコピー
    for (const op of oplogA.ops) {
      if (op.type === 'ins') {
        localInsert(merged, 'A', op.pos, op.content)
      } else {
        localDelete(merged, 'A', op.pos)
      }
    }
    // Bの操作をコピー
    const bCopy = createOpLog<string>()
    for (const op of oplogB.ops) {
      if (op.type === 'ins') {
        localInsert(bCopy, 'B', op.pos, op.content)
      } else {
        localDelete(bCopy, 'B', op.pos)
      }
    }
    mergeOplogInto(merged, bCopy)

    const result = checkoutSimpleString(merged)
    resultText.textContent = result || '（空文字列）'
    resultStats.textContent = `操作数: A=${opCount(oplogA)}, B=${opCount(oplogB)} → マージ後合計=${merged.ops.length}`
  }

  // DOMに追加された後にセットアップを実行
  requestAnimationFrame(setup)

  return container
}

/** デフォルト: 空の状態から手動操作 */
export const Default: Story = {
  render: () => createDemoUI({}),
}

/** プリセット: 同じ位置への同時挿入 */
export const PresetConcurrentInsert: Story = {
  render: () => createDemoUI({ preset: 'concurrent-insert' }),
}

/** プリセット: 挿入と削除 */
export const PresetInsertAndDelete: Story = {
  render: () => createDemoUI({ preset: 'insert-and-delete' }),
}
