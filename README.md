# crdt-eg-walker

Eg-walker CRDTの高速なTypeScript実装です。
[josephg/eg-walker-reference](https://github.com/josephg/eg-walker-reference) のリファレンス実装をベースに、外部依存ゼロ・型安全な独自実装として再構築し、大幅な高速化を実現しています。

リファレンス実装はアルゴリズム以外の設計が遅く通常のCRDTとの正しい比較ができなくなっているので、リファレンス実装の改良版を作りました。

## Eg-walkerについて

Eg-walkerは、Google DocsやFigmaのような複数人でリアルタイムに共同編集できるシステムを構築するためのCRDTアルゴリズムです。

従来のCRDT（Yjs等）が抱える以下の問題を解決します:

- **メモリ使用量が多い**: 全操作のメタデータ（tombstone等）を常にメモリに保持する必要がある
- **ファイルを開くのが遅い**: エンコード済み状態の復元は速いが、CRDT構造体の常駐コストが大きい

Eg-walkerはテキストのみを保持し、ドキュメントの操作（追加、マージなど）が必要な時にのみイベントグラフを走査して計算します。これにより、メモリ使用量の大幅な削減と、ファイルを高速に開くことができます。

論文: https://arxiv.org/html/2409.14252v1

## セットアップ

### インストール

```bash
# リポジトリのクローン（サブモジュールも含めて取得）
git clone --recursive https://github.com/waka/crdt-eg-walker.git
cd egwalker-js

# サブモジュールのみ後から取得する場合（ベンチマークテストを実行するときのみ）
git submodule update --init --recursive

# 依存関係のインストール
npm install
```

### ベンチマーク用のサブモジュールビルド

ベンチマークとメモリ使用量テストでは比較対象として、メジャーなCRDT実装である [Yjs](https://github.com/yjs/yjs) と、このライブラリの参考にしている eg-walker の参照実装である [eg-walker-reference](https://github.com/josephg/eg-walker-reference) を使用しています。  
これらは Git サブモジュールとして `vendor/` 以下に配置されており、実行前にビルドが必要です。

```bash
# Yjs のビルド
cd vendor/yjs
npm install
npm run dist
cd ../..

# eg-walker-reference のビルド
cd vendor/eg-walker-reference
npm install
npm run prepare
cd ../..
```

### テスト・ベンチマークの実行

```bash
# 型チェック
npx tsc --noEmit

# テスト実行
npx vitest run

# ベンチマーク実行
npx vitest bench
```

## ベンチマーク結果

以下は Yjs (v13.6.29) およびリファレンス実装との比較ベンチマーク結果です。
hzは1秒あたりの実行回数（高いほど速い）を示します。

### 小文書（1,000文字）

| ベンチマーク | eg-walker | reference | Yjs | vs reference | vs Yjs |
|---|---:|---:|---:|---|---|
| 逐次挿入（末尾追加） | 2,801 hz | 985 hz | 711 hz | **2.8x** 速い | **3.9x** 速い |
| ランダム位置挿入 | 1,575 hz | 1,551 hz | 507 hz | **1.0x** 同等 | **3.1x** 速い |
| 並行編集+マージ | 2,115 hz | 864 hz | 646 hz | **2.4x** 速い | **3.3x** 速い |
| 挿入+削除の混合 | 4,024 hz | 2,058 hz | 665 hz | **2.0x** 速い | **6.0x** 速い |

全シナリオでeg-walkerが最速です。

### 大文書（10,000文字）構築

| ベンチマーク | eg-walker | reference | Yjs | vs reference | vs Yjs |
|---|---:|---:|---:|---|---|
| 末尾に1文字ずつ追加 | 196 hz | 10 hz | 69 hz | **19.8x** 速い | **2.8x** 速い |

ゼロから大文書を構築するケースでもeg-walkerが最速です。

### 大文書（10,000文字）への増分更新

既存の大文書に対して少数の操作を追加するシナリオです。
`mergeChangesIntoBranch` のfast-forwardパスにより、10,000件の既存操作のフルリプレイを回避し、新しい操作のみを直接適用します。

| ベンチマーク | eg-walker | Yjs | vs Yjs |
|---|---:|---:|---|
| ランダム挿入 ×100 | 6,193 hz | 4,037 hz | **1.5x** 速い |
| ランダム削除 ×100 | 7,145 hz | 3,206 hz | **2.2x** 速い |
| 挿入+削除 ×200 | 5,148 hz | 1,746 hz | **2.9x** 速い |
| 並行編集+マージ | 6,161 hz | 2,174 hz | **2.8x** 速い |

全シナリオでYjsを上回っています。

### Document APIでのローカル編集

Document APIを使って10,000文字のドキュメントをゼロから構築するシナリオです。

| ベンチマーク | eg-walker | Yjs | vs Yjs |
|---|---:|---:|---|
| 10,000文字構築 | 473 hz | 59 hz | **8.0x** 速い |

### ドキュメントオープン（操作履歴からの復元）

保存された操作履歴からドキュメントの文字列を取得するまでの時間です。

| 文書サイズ | eg-walker (TextDocument) | eg-walker (Document) | eg-walker (checkout) | Yjs | vs Yjs |
|---|---:|---:|---:|---:|---|
| 10,000文字 | 16,340,916 hz | 12,906 hz | 226 hz | 18,699 hz | **874x** 速い |
| 50,000文字 | 17,207,011 hz | 1,125 hz | 34 hz | 14,913 hz | **1,154x** 速い |

`TextDocument` はスナップショットを `string` で直接保持するため、`restoreTextDocument` + `getTextDocText` は文字列をそのまま返すだけで済みます。文書サイズに依存せず **1,600万〜1,700万 ops/sec** を実現し、Yjsと比較して **874〜1,154倍** 高速です。

なお、フルリプレイ（checkout）はOpLogから全操作を再生するため、初回オープンではYjsより遅くなります。（スナップショットをキャッシュしておけば `TextDocument` で即座に復元できます。）

### メモリ使用量

`process.memoryUsage()` ベースの概算値です（GCの影響により実行ごとに変動します）。

| シナリオ | eg-walker OpLog | Yjs Doc | Yjs / eg-walker |
|---|---:|---:|---|
| 10,000文字（逐次挿入） | ~1 MB | ~3.5 MB | Yjs **約3.6倍** 多い |
| 50,000文字（逐次挿入） | ~2 MB | ~9.6 MB | Yjs **約4.7倍** 多い |

eg-walkerは操作ログのみを保持し、CRDTメタデータ（Item構造体、tombstone等）を常駐させないため、Yjsと比較してメモリ使用量が大幅に少なくなっています。

## 使い方

### ドキュメントの作成・編集

```typescript
import { createDocument, docInsert, docDelete, getText } from 'crdt-eg-walker'

const doc = createDocument<string>()

// ローカル編集（エージェントIDを渡す）
docInsert(doc, 'agent-A', 0, 'h', 'e', 'l', 'l', 'o')
docDelete(doc, 'agent-A', 0)  // 先頭1文字削除
console.log(getText(doc))     // "ello"
```

テキスト特化の `TextDocument` を使うと、スナップショットを文字列で直接管理できます。

```typescript
import { createTextDocument, textDocInsert, getTextDocText } from 'crdt-eg-walker'

const doc = createTextDocument()
textDocInsert(doc, 'agent-A', 0, 'hello')
console.log(getTextDocText(doc))  // "hello"
```

### ネットワーク同期

`Provider` でネットワーク層を抽象化します。`WebSocketProvider` は本番用、`InMemoryProvider` はテスト・デモ用です。

```typescript
import {
  createDocument, docInsert, mergeRemote,
  encodeOpLog, decodeOpLog,
  WebSocketProvider,
} from 'crdt-eg-walker'

const doc = createDocument<string>()
const provider = new WebSocketProvider('wss://example.com/sync')

// リモートから op を受け取ってマージ
provider.on('op', (data) => {
  const remoteOplog = decodeOpLog<string>(data)
  mergeRemote(doc, remoteOplog)
})

provider.connect()

// ローカル編集後にブロードキャスト
docInsert(doc, 'agent-A', 0, 'h', 'i')
provider.sendOp(encodeOpLog(doc.oplog))
```

op と Awareness を同一チャンネルで流す場合は `encodeMessage` / `decodeMessage` でフレーミングします。

```typescript
import { encodeMessage, decodeMessage } from 'crdt-eg-walker'

// 送信
provider.sendOp(encodeMessage({ type: 'op', data: encodeOpLog(doc.oplog) }))

// 受信
provider.on('op', (raw) => {
  const msg = decodeMessage(raw)
  if (msg.type === 'op') {
    mergeRemote(doc, decodeOpLog(msg.data))
  } else if (msg.type === 'awareness') {
    awareness.applyRemoteState(msg.clientId, msg.data)
  }
})
```

### カーソル位置の相対化（Anchor）

整数インデックスで持つカーソル位置は、リモートの挿入・削除でズレます。`Anchor` を使うと「何番目の文字の後ろ」ではなく「どのアイテムの後ろ」で保持できます。

```typescript
import {
  createEditContext, traverseAndApply,
  indexToAnchor, anchorToIndex,
} from 'crdt-eg-walker'

// EditContext を構築（リモート op 適用前に取得）
const ctx = createEditContext(doc.oplog.ops.length)
traverseAndApply(ctx, doc.oplog, null)

// カーソル位置 → Anchor に変換して保持
const anchor = indexToAnchor(ctx, cursorIndex)

// リモート op を適用後、Anchor → カーソル位置に戻す
mergeRemote(doc, remoteOplog)
const ctxAfter = createEditContext(doc.oplog.ops.length)
traverseAndApply(ctxAfter, doc.oplog, null)
const newIndex = anchorToIndex(ctxAfter, anchor)
```

### Undo / Redo

`Transaction` でグループ化し、`UndoManager` で逆操作を生成します。他ユーザーの操作には影響しません。

```typescript
import {
  createDocument, docInsert, docDelete,
  Transaction, UndoManager, buildUndoContext,
} from 'crdt-eg-walker'

const doc = createDocument<string>()
const tx = new Transaction()
const um = new UndoManager<string>('agent-A')

// IME確定などのまとまった操作を1グループにする
const group = tx.transact(doc.oplog, () => {
  docInsert(doc, 'agent-A', 0, 'h', 'e', 'l', 'l', 'o')
})
um.push(group)

// Undo
if (um.canUndo) {
  const ctx = buildUndoContext(doc.oplog)
  um.undo(ctx, doc.oplog, (ops) => {
    for (const op of ops) {
      if (op.type === 'del') docDelete(doc, 'agent-A', op.pos)
      else docInsert(doc, 'agent-A', op.pos, op.content)
    }
  })
}

// Redo
if (um.canRedo) {
  const ctx = buildUndoContext(doc.oplog)
  um.redo(ctx, doc.oplog, (ops) => {
    for (const op of ops) {
      if (op.type === 'del') docDelete(doc, 'agent-A', op.pos)
      else docInsert(doc, 'agent-A', op.pos, op.content)
    }
  })
}
```

### Awareness（リモートカーソル共有）

CRDT で同期するほどではないが今すぐ他ユーザーに伝えたい状態（カーソル・ユーザー名など）を共有します。Last-Write-Wins で十分な揮発性データ向けです。

```typescript
import { Awareness } from 'crdt-eg-walker'

type EditorState = {
  cursor: { anchor: Anchor; head: Anchor }
  user: { name: string; color: string }
}

const awareness = new Awareness<EditorState>()

// カーソルが動いたとき
awareness.setLocalState(myClientId, {
  cursor: { anchor: indexToAnchor(ctx, selStart), head: indexToAnchor(ctx, selEnd) },
  user: { name: 'waka', color: '#E8F4F8' },
})

// 他クライアントの状態を受信したとき
awareness.on('change', (states) => {
  renderRemoteCursors(states)
})

// ハートビート（30秒間隔でブロードキャスト、60秒無応答でオフライン扱い）
awareness.startHeartbeat(
  myClientId,
  () => awareness.getState(myClientId)!,
  (state) => provider.sendOp(encodeMessage({ type: 'awareness', clientId: myClientId, data: state })),
)
```

---

## アーキテクチャ

```
src/
  types.ts                 - 型定義
  causal-graph.ts          - 因果グラフ（CG）基本操作
  causal-graph-advanced.ts - CG高度操作（diff, findConflicting等）
  oplog.ts                 - 操作ログ管理
  edit-context.ts          - 編集アルゴリズム（Fugue/YjsMod統合）
  branch.ts                - ブランチ操作（checkout, 増分更新）
  document.ts              - Document（OpLog + T[]スナップショット統合管理）
  text-document.ts         - TextDocument（テキスト特化、stringスナップショット）
  encoding.ts              - MessagePack シリアライズ（OpLog・Message）
  provider.ts              - Provider インターフェース + WebSocket/InMemory 実装
  anchor.ts                - Anchor（相対カーソル位置）
  transaction.ts           - Transaction（操作グループ化）
  undo-manager.ts          - UndoManager（協調編集対応 Undo/Redo）
  awareness.ts             - Awareness（リアルタイム共有状態）
  index.ts                 - 公開APIエントリポイント
```

## ライセンス

本プロジェクトは MIT ライセンスで公開しています。

本プロジェクトは [josephg/eg-walker-reference](https://github.com/josephg/eg-walker-reference)（BSD-2-Clause）をベースにしており、LICENSEファイルにその著作権表示を含めています。

vendorディレクトリのサブモジュールはそれぞれ独自のライセンスに従います:
- [eg-walker-reference](https://github.com/josephg/eg-walker-reference): BSD-2-Clause
- [Yjs](https://github.com/yjs/yjs): MIT
