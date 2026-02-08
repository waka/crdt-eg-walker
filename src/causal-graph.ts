/**
 * 因果グラフ (Causal Graph) の基本操作
 *
 * 操作IDと親子関係をRLE圧縮して保持するデータ構造。
 * すべての変更は [agent, seq] ペアまたはローカルバージョン (LV) で参照可能。
 */

import { binarySearch } from './utils/binary-search.js'
import { pushRLERange } from './utils/rle.js'
import type {
  LV,
  LVRange,
  RawVersion,
  CGEntry,
  CausalGraph,
  ClientEntry,
  VersionSummary,
} from './types.js'

export type { ClientEntry } from './types.js'

// ===== ヘルパー関数 =====

const min2 = (a: number, b: number): number => (a < b ? a : b)
const max2 = (a: number, b: number): number => (a > b ? a : b)

/** バージョンを昇順にソート */
const sortVersions = (v: LV[]): LV[] => v.sort((a, b) => a - b)

// ===== RLEリスト操作 =====

/** RLEリストに要素を追加。直前の要素とマージ可能ならマージする */
const pushRLEList = <T>(list: T[], newItem: T, tryAppend: (a: T, b: T) => boolean): void => {
  if (list.length === 0 || !tryAppend(list[list.length - 1]!, newItem)) {
    list.push(newItem)
  }
}

/**
 * RLEリストに要素を挿入。末尾以外の位置にも挿入可能。
 * 同一エージェントが複数ブランチを編集するケースに対応。
 */
const insertRLEList = <T>(
  list: T[],
  newItem: T,
  getKey: (e: T) => number,
  tryAppend: (a: T, b: T) => boolean,
): void => {
  const newKey = getKey(newItem)
  if (list.length === 0 || newKey >= getKey(list[list.length - 1]!)) {
    // 通常ケース: 末尾に追加
    pushRLEList(list, newItem, tryAppend)
  } else {
    // 中間に挿入が必要
    let idx = binarySearch(list, (entry) => newKey - getKey(entry))
    if (idx >= 0) throw Error('無効な状態 - アイテムが既に存在します')

    idx = -idx - 1 // 挿入先インデックス

    if (idx === 0 || !tryAppend(list[idx - 1]!, newItem)) {
      list.splice(idx, 0, newItem)
    }
  }
}

// ===== CGEntryのマージ判定 =====

const tryAppendEntries = (a: CGEntry, b: CGEntry): boolean => {
  const canAppend =
    b.version === a.vEnd &&
    a.agent === b.agent &&
    a.seq + (a.vEnd - a.version) === b.seq &&
    b.parents.length === 1 &&
    b.parents[0] === a.vEnd - 1

  if (canAppend) {
    a.vEnd = b.vEnd
  }
  return canAppend
}

const tryAppendClientEntry = (a: ClientEntry, b: ClientEntry): boolean => {
  const canAppend =
    b.seq === a.seqEnd && b.version === a.version + (a.seqEnd - a.seq)

  if (canAppend) {
    a.seqEnd = b.seqEnd
  }
  return canAppend
}

// ===== ClientEntry検索 =====

const findClientEntryRaw = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): ClientEntry | null => {
  const av = cg.agentToVersion.get(agent)
  if (av == null) return null

  const result = binarySearch(av, (entry) =>
    seq < entry.seq ? -1 : seq >= entry.seqEnd ? 1 : 0,
  )

  return result < 0 ? null : av[result]!
}

const findClientEntryTrimmed = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): ClientEntry | null => {
  const clientEntry = findClientEntryRaw(cg, agent, seq)
  if (clientEntry == null) return null

  const offset = seq - clientEntry.seq
  return offset === 0
    ? clientEntry
    : {
        seq,
        seqEnd: clientEntry.seqEnd,
        version: clientEntry.version + offset,
      }
}

// ===== 公開API =====

/** 空の因果グラフを作成 */
export const createCG = (): CausalGraph => ({
  heads: [],
  entries: [],
  agentToVersion: new Map(),
})

/** エージェントのClientEntryリストを取得（なければ作成） */
export const clientEntriesForAgent = (
  cg: CausalGraph,
  agent: string,
): ClientEntry[] => {
  let entries = cg.agentToVersion.get(agent)
  if (entries == null) {
    entries = []
    cg.agentToVersion.set(agent, entries)
  }
  return entries
}

/** 次のLV（操作の総数）を返す */
export const nextLV = (cg: CausalGraph): LV => {
  if (cg.entries.length === 0) return 0
  return cg.entries[cg.entries.length - 1]!.vEnd
}

/** 指定エージェントの次のシーケンス番号を返す */
export const nextSeqForAgent = (cg: CausalGraph, agent: string): number => {
  const entries = cg.agentToVersion.get(agent)
  if (entries == null || entries.length === 0) return 0
  return entries[entries.length - 1]!.seqEnd
}

/** フロンティアを前進させる */
export const advanceFrontier = (
  frontier: LV[],
  vLast: LV,
  parents: LV[],
): LV[] => {
  const f = frontier.filter((v) => !parents.includes(v))
  f.push(vLast)
  return sortVersions(f)
}

/** 指定エージェント・シーケンス番号のバージョンが既知かどうか */
export const hasVersion = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): boolean => findClientEntryRaw(cg, agent, seq) != null

/**
 * 因果グラフにエントリを追加する (LV[]ベースの親指定)。
 * 既に存在する範囲はスキップする。
 * 全て既存の場合はnullを返す。
 */
export const add = (
  cg: CausalGraph,
  agent: string,
  seqStart: number,
  seqEnd: number,
  parents: LV[],
): CGEntry | null => {
  const version = nextLV(cg)

  while (true) {
    // 既存エントリと重複する範囲をチェック
    const existingEntry = findClientEntryTrimmed(cg, agent, seqStart)
    if (existingEntry == null) break // 新規範囲 → 挿入

    if (existingEntry.seqEnd >= seqEnd) return null // 全て既存

    // 一部既存 → トリムして続行
    seqStart = existingEntry.seqEnd
    parents = [
      existingEntry.version + (existingEntry.seqEnd - existingEntry.seq) - 1,
    ]
  }

  const len = seqEnd - seqStart
  const vEnd = version + len
  const entry: CGEntry = {
    version,
    vEnd,
    agent,
    seq: seqStart,
    parents,
  }

  // エントリリストに追加（バージョン順を維持）
  pushRLEList(cg.entries, entry, tryAppendEntries)

  // エージェントのエントリリストに挿入（順序外挿入に対応）
  insertRLEList(
    clientEntriesForAgent(cg, agent),
    { seq: seqStart, seqEnd, version },
    (e) => e.seq,
    tryAppendClientEntry,
  )

  cg.heads = advanceFrontier(cg.heads, vEnd - 1, parents)
  return entry
}

/** 因果グラフにエントリを追加する (RawVersionベースの親指定) */
export const addRaw = (
  cg: CausalGraph,
  id: RawVersion,
  len: number = 1,
  rawParents?: RawVersion[],
): CGEntry | null => {
  const parents =
    rawParents != null ? rawToLVList(cg, rawParents) : cg.heads

  return add(cg, id[0], id[1], id[1] + len, parents)
}

/**
 * 指定LVのシーケンスを新たに割り当てる。
 * 既知のシーケンス番号が不正な場合はエラー。
 */
export const assignLocal = (
  cg: CausalGraph,
  agentId: string,
  seq: number,
  parents: LV[] = cg.heads,
  num: number = 1,
): LV => {
  const version = nextLV(cg)
  const av = clientEntriesForAgent(cg, agentId)
  const nextValidSeq =
    av.length === 0 ? 0 : av[av.length - 1]!.seqEnd
  if (seq < nextValidSeq) throw Error('無効なエージェントシーケンス番号')
  add(cg, agentId, seq, seq + num, parents)
  return version
}

// ===== LV ↔ RawVersion 変換 =====

/** LVを含むCGEntryを検索（生エントリ） */
export const findEntryContainingRaw = (cg: CausalGraph, v: LV): CGEntry => {
  const idx = binarySearch(cg.entries, (entry) =>
    v < entry.version ? -1 : v >= entry.vEnd ? 1 : 0,
  )
  if (idx < 0) throw Error('無効または未知のローカルバージョン: ' + v)
  return cg.entries[idx]!
}

/** LVを含むCGEntryとオフセットを返す */
export const findEntryContaining = (
  cg: CausalGraph,
  v: LV,
): [CGEntry, number] => {
  const e = findEntryContainingRaw(cg, v)
  return [e, v - e.version]
}

/** LV → RawVersion変換 */
export const lvToRaw = (cg: CausalGraph, v: LV): RawVersion => {
  const [e, offset] = findEntryContaining(cg, v)
  return [e.agent, e.seq + offset]
}

/** LV → RawVersion + 親を返す */
export const lvToRawWithParents = (
  cg: CausalGraph,
  v: LV,
): [string, number, LV[]] => {
  const [e, offset] = findEntryContaining(cg, v)
  const parents = offset === 0 ? e.parents : [v - 1]
  return [e.agent, e.seq + offset, parents]
}

/** LV[] → RawVersion[]変換 */
export const lvToRawList = (
  cg: CausalGraph,
  parents: LV[] = cg.heads,
): RawVersion[] => parents.map((v) => lvToRaw(cg, v))

/** RawVersion → LV変換（見つからない場合null） */
export const tryRawToLV = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): LV | null => {
  const clientEntry = findClientEntryTrimmed(cg, agent, seq)
  return clientEntry?.version ?? null
}

/** RawVersion → LV変換（見つからない場合エラー） */
export const rawToLV = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): LV => {
  const clientEntry = findClientEntryTrimmed(cg, agent, seq)
  if (clientEntry == null) throw Error(`未知のID: (${agent}, ${seq})`)
  return clientEntry.version
}

/** RawVersion → LV変換（タプル引数版） */
export const rawToLV2 = (cg: CausalGraph, v: RawVersion): LV =>
  rawToLV(cg, v[0], v[1])

/** RawVersion[] → LV[]変換 */
export const rawToLVList = (
  cg: CausalGraph,
  parents: RawVersion[],
): LV[] => parents.map(([agent, seq]) => rawToLV(cg, agent, seq))

/** RawVersion → LVの範囲 [start, end) を返す */
export const rawToLVSpan = (
  cg: CausalGraph,
  agent: string,
  seq: number,
): [LV, LV] => {
  const clientEntry = findClientEntryRaw(cg, agent, seq)
  if (clientEntry == null) throw Error(`未知のID: (${agent}, ${seq})`)
  const offset = seq - clientEntry.seq
  return [
    clientEntry.version + offset,
    clientEntry.seqEnd - clientEntry.seq + clientEntry.version,
  ]
}

/** RawVersionの比較 */
export const rawVersionCmp = (
  [a1, s1]: RawVersion,
  [a2, s2]: RawVersion,
): number => (a1 < a2 ? -1 : a1 > a2 ? 1 : s1 - s2)

/** LVの比較（RawVersionに変換して比較） */
export const lvCmp = (cg: CausalGraph, a: LV, b: LV): number =>
  rawVersionCmp(lvToRaw(cg, a), lvToRaw(cg, b))

// ===== バージョンイテレーション =====

/** 指定バージョン範囲のエントリをイテレートする */
export function* iterVersionsBetween(
  cg: CausalGraph,
  vStart: LV,
  vEnd: LV,
): Generator<CGEntry> {
  if (vStart === vEnd) return

  let idx = binarySearch(cg.entries, (entry) =>
    vStart < entry.version ? -1 : vStart >= entry.vEnd ? 1 : 0,
  )
  if (idx < 0) throw Error('無効または不足しているバージョン: ' + vStart)

  for (; idx < cg.entries.length; idx++) {
    const entry = cg.entries[idx]!
    if (entry.version >= vEnd) break

    if (vStart <= entry.version && vEnd >= entry.vEnd) {
      // エントリ全体を返す
      yield entry
    } else {
      // エントリの一部をスライスして返す
      const vLocalStart = max2(vStart, entry.version)
      const vLocalEnd = min2(vEnd, entry.vEnd)

      yield {
        version: vLocalStart,
        vEnd: vLocalEnd,
        agent: entry.agent,
        seq: entry.seq + (vLocalStart - entry.version),
        parents:
          vLocalStart === entry.version ? entry.parents : [vLocalStart - 1],
      }
    }
  }
}

/** バージョン範囲のエントリを訪問する（コールバック版） */
export const eachVersionBetween = (
  cg: CausalGraph,
  vStart: LV,
  vEnd: LV,
  visit: (e: CGEntry, vs: number, ve: number) => void,
): void => {
  let idx = binarySearch(cg.entries, (entry) =>
    vStart < entry.version ? -1 : vStart >= entry.vEnd ? 1 : 0,
  )
  if (idx < 0) throw Error('無効または不足しているバージョン: ' + vStart)

  for (; idx < cg.entries.length; idx++) {
    const entry = cg.entries[idx]!
    if (entry.version >= vEnd) break
    visit(entry, max2(vStart, entry.version), min2(vEnd, entry.vEnd))
  }
}

// ===== バージョンサマリ =====

/** 因果グラフのバージョンサマリを生成 */
export const summarizeVersion = (cg: CausalGraph): VersionSummary => {
  const result: VersionSummary = new Map()
  for (const [agent, av] of cg.agentToVersion) {
    if (av.length === 0) continue

    const versions: LVRange[] = []
    for (const ce of av) {
      pushRLERange(versions, ce.seq, ce.seqEnd)
    }
    result.set(agent, versions)
  }
  return result
}

/** LV[]の等値比較 */
export const lvEq = (a: LV[], b: LV[]): boolean =>
  a.length === b.length && a.every((val, idx) => b[idx] === val)
