# crdt-eg-walker

Eg-walker CRDTの高速なTypeScript実装です。
[josephg/eg-walker-reference](https://github.com/josephg/eg-walker-reference) のリファレンス実装をベースに、外部依存ゼロ・型安全な独自実装として再構築し、大幅な高速化を実現しています。

## Eg-walkerについて

Eg-walkerは、Google DocsやFigmaのような複数人でリアルタイムに共同編集できるシステムを構築するためのCRDTアルゴリズムです。

従来のCRDT（Yjs等）が抱える以下の問題を解決します:

- **メモリ使用量が多い**: 全操作のメタデータ（tombstone等）を常にメモリに保持する必要がある
- **ファイルを開くのが遅い**: エンコード済み状態の復元は速いが、CRDT構造体の常駐コストが大きい

Eg-walkerは操作ログ（OpLog）のみを保持し、ドキュメント状態は必要な時にイベントグラフを走査して計算します。これにより、メモリ使用量を大幅に削減できます。

論文: https://arxiv.org/html/2409.14252v1

## セットアップ

### 前提条件

- Node.js >= 18
- Git

### インストール

```bash
# リポジトリのクローン（サブモジュールも含めて取得）
git clone --recursive https://github.com/takumi-asobi/egwalker-js.git
cd egwalker-js

# サブモジュールのみ後から取得する場合
git submodule update --init --recursive

# 依存関係のインストール
npm install
```

### ベンチマーク用のサブモジュールビルド

ベンチマークとメモリ使用量テストでは、比較対象として [Yjs](https://github.com/yjs/yjs) と [eg-walker-reference](https://github.com/josephg/eg-walker-reference) を使用しています。これらは Git サブモジュールとして `vendor/` 以下に配置されており、実行前にビルドが必要です。

```bash
# Yjs のビルド
cd vendor/yjs
npm install
npm run dist
cd ../..

# eg-walker-reference は dist/ がリポジトリに含まれているためビルド不要
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
| 逐次挿入（末尾追加） | 8,199 hz | 1,085 hz | 766 hz | **7.6x** 速い | **10.7x** 速い |
| ランダム位置挿入 | 2,912 hz | 1,711 hz | 596 hz | **1.7x** 速い | **4.9x** 速い |
| 並行編集+マージ | 5,707 hz | 980 hz | 723 hz | **5.8x** 速い | **7.9x** 速い |
| 挿入+削除の混合 | 6,407 hz | 2,388 hz | 730 hz | **2.7x** 速い | **8.8x** 速い |

全シナリオでeg-walkerが最速です。

### 大文書（10,000文字）構築

| ベンチマーク | eg-walker | reference | Yjs | vs Yjs |
|---|---:|---:|---:|---|
| 末尾に1文字ずつ追加 | 761 hz | 11 hz | 77 hz | **9.9x** 速い |

ゼロから大文書を構築するケースでもeg-walkerが大幅に速いです。

### 大文書（10,000文字）への増分更新

既存の大文書に対して少数の操作を追加するシナリオです。
`mergeChangesIntoBranch` のfast-forwardパスにより、10,000件の既存操作のフルリプレイを回避し、新しい操作のみを直接適用します。

| ベンチマーク | eg-walker (増分) | eg-walker (フルリプレイ) | Yjs | 増分 vs Yjs |
|---|---:|---:|---:|---|
| ランダム挿入 ×100 | 7,035 hz | 891 hz | 4,286 hz | **1.6x** 速い |
| ランダム削除 ×100 | 8,342 hz | 757 hz | 3,538 hz | **2.4x** 速い |
| 挿入+削除 ×200 | 5,788 hz | 511 hz | 1,984 hz | **2.9x** 速い |
| 並行編集+マージ | 7,322 hz | 710 hz | 2,455 hz | **3.0x** 速い |

増分更新により、フルリプレイ比で **8〜11倍** の高速化を実現し、全シナリオでYjsを上回っています。

### ドキュメントオープン（操作履歴からの復元）

保存された操作履歴からドキュメントの文字列を取得するまでの時間です。
Yjsはバイナリ状態からのデシリアライズのみで済むため、このシナリオではYjsが高速です。

| 文書サイズ | eg-walker checkout | Yjs applyUpdate+toString | 比較 |
|---|---:|---:|---|
| 10,000文字 | 2,018 hz (0.50ms) | 20,788 hz (0.05ms) | Yjs **10x** 速い |
| 50,000文字 | 237 hz (4.2ms) | 18,208 hz (0.05ms) | Yjs **77x** 速い |

これはeg-walkerの設計上のトレードオフです。eg-walkerはOpLogから全操作をリプレイして文書状態を計算するため、初回オープンではYjsより遅くなります。ただし、一度checkoutした後の増分更新はYjsより高速です。

### メモリ使用量

`process.memoryUsage()` ベースの概算値です（GCの影響により実行ごとに変動します）。

| シナリオ | eg-walker OpLog | Yjs Doc | Yjs / eg-walker |
|---|---:|---:|---|
| 10,000文字（逐次挿入） | ~1 MB | ~3.5 MB | Yjs **約3.6倍** 多い |
| 50,000文字（逐次挿入） | ~2 MB | ~9.6 MB | Yjs **約4.7倍** 多い |

eg-walkerは操作ログのみを保持し、CRDTメタデータ（Item構造体、tombstone等）を常駐させないため、Yjsと比較してメモリ使用量が大幅に少なくなっています。

## アーキテクチャ

```
src/
  types.ts              - 型定義
  causal-graph.ts       - 因果グラフ（CG）基本操作
  causal-graph-utils.ts - CG高度操作（diff, findConflicting等）
  oplog.ts              - 操作ログ管理
  edit-context.ts       - 核心アルゴリズム（Fugue/YjsMod統合）
  branch.ts             - ブランチ操作（checkout, 増分更新）
  index.ts              - 公開APIエントリポイント
```

## ライセンス

本プロジェクトは MIT ライセンスで公開しています。

本プロジェクトは [josephg/eg-walker-reference](https://github.com/josephg/eg-walker-reference)（BSD-2-Clause）をベースにしており、LICENSEファイルにその著作権表示を含めています。

vendorディレクトリのサブモジュールはそれぞれ独自のライセンスに従います:
- [eg-walker-reference](https://github.com/josephg/eg-walker-reference): BSD-2-Clause
- [Yjs](https://github.com/yjs/yjs): MIT
