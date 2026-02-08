/**
 * 因果グラフ (Causal Graph) の高度な操作
 *
 * diff, findConflicting, findDominators, versionContainsLV 等
 */

import { PriorityQueue } from './utils/priority-queue.js'
import { binarySearch } from './utils/binary-search.js'
import {
  findEntryContainingRaw,
  findEntryContaining,
  lvToRawList,
  lvEq,
  eachVersionBetween,
  addRaw,
  nextLV,
} from './causal-graph.js'
import type {
  LV,
  LVRange,
  RawVersion,
  CausalGraph,
  DiffFlag,
  VersionSummary,
} from './types.js'

// const enumの値を直接使用
const DiffFlagOnlyA: DiffFlag = 0 as DiffFlag
const DiffFlagOnlyB: DiffFlag = 1 as DiffFlag
const DiffFlagShared: DiffFlag = 2 as DiffFlag

const min2 = (a: number, b: number): number => (a < b ? a : b)

// ===== diff =====

/** 逆順RLE追加（diffの結果は逆順で構築されるため） */
const pushReversedRLE = (list: LVRange[], start: LV, end: LV): void => {
  if (list.length > 0) {
    const last = list[list.length - 1]!
    if (last[0] === end) {
      last[0] = start
      return
    }
  }
  list.push([start, end])
}

/** diff結果 */
export interface DiffResult {
  aOnly: LVRange[]
  bOnly: LVRange[]
}

/**
 * 2つのバージョン（フロンティア）間の差分を計算する。
 * aにのみ含まれる操作範囲とbにのみ含まれる操作範囲を返す。
 */
export const diff = (
  cg: CausalGraph,
  a: LV[],
  b: LV[],
): DiffResult => {
  // 同一バージョン同士なら空結果を即時返却
  if (lvEq(a, b)) return { aOnly: [], bOnly: [] }

  const flags = new Map<number, DiffFlag>()

  // 最大ヒープ（大きいバージョンから処理）
  const queue = new PriorityQueue<number>((x, y) => y - x)

  let numShared = 0

  const enq = (v: LV, flag: DiffFlag): void => {
    const currentType = flags.get(v)
    if (currentType == null) {
      queue.push(v)
      flags.set(v, flag)
      if (flag === DiffFlagShared) numShared++
    } else if (flag !== currentType && currentType !== DiffFlagShared) {
      flags.set(v, DiffFlagShared)
      numShared++
    }
  }

  for (const v of a) enq(v, DiffFlagOnlyA)
  for (const v of b) enq(v, DiffFlagOnlyB)

  const aOnly: LVRange[] = []
  const bOnly: LVRange[] = []

  const markRun = (start: LV, endInclusive: LV, flag: DiffFlag): void => {
    if (flag === DiffFlagShared) return
    const target = flag === DiffFlagOnlyA ? aOnly : bOnly
    pushReversedRLE(target, start, endInclusive + 1)
  }

  // 全てがSharedになるまでループ
  while (queue.size > numShared) {
    let v = queue.pop()!
    let flag = flags.get(v)!

    if (flag === DiffFlagShared) numShared--

    const e = findEntryContainingRaw(cg, v)

    // このエントリ内に次のキューアイテムがあるか確認
    while (!queue.isEmpty() && queue.peek()! >= e.version) {
      const v2 = queue.pop()!
      const flag2 = flags.get(v2)!
      if (flag2 === DiffFlagShared) numShared--

      if (flag2 !== flag) {
        markRun(v2 + 1, v, flag)
        v = v2
        flag = DiffFlagShared
      }
    }

    markRun(e.version, v, flag)

    for (const p of e.parents) enq(p, flag)
  }

  aOnly.reverse()
  bOnly.reverse()
  return { aOnly, bOnly }
}

// ===== isFastForward =====

/**
 * fromからtoへのfast-forwardが可能かどうか判定する。
 * diff(cg, from, to).aOnly が空ならfast-forward可能。
 */
export const isFastForward = (
  cg: CausalGraph,
  from: LV[],
  to: LV[],
): boolean => {
  if (lvEq(from, to)) return true
  return diff(cg, from, to).aOnly.length === 0
}

// ===== versionContainsLV =====

/** フロンティアがtargetを含むかどうか判定 */
export const versionContainsLV = (
  cg: CausalGraph,
  frontier: LV[],
  target: LV,
): boolean => {
  if (frontier.includes(target)) return true

  const queue = new PriorityQueue<number>((a, b) => b - a)
  for (const v of frontier) if (v > target) queue.push(v)

  while (queue.size > 0) {
    const v = queue.pop()!

    if (v === target) return true

    const e = findEntryContainingRaw(cg, v)
    if (e.version <= target) return true

    // このエントリ内のキューアイテムをクリア
    while (!queue.isEmpty() && queue.peek()! >= e.version) {
      queue.pop()
    }

    for (const p of e.parents) {
      if (p === target) return true
      else if (p > target) queue.push(p)
    }
  }

  return false
}

// ===== findDominators =====

/**
 * 入力バージョン群からドミネーターを検出する。
 * 各入力バージョンについてコールバックが正確に1回呼ばれる。
 */
export function findDominators2(
  cg: CausalGraph,
  versions: LV[],
  cb: (v: LV, isDominator: boolean) => void,
): void {
  if (versions.length === 0) return
  if (versions.length === 1) {
    cb(versions[0]!, true)
    return
  }
  if (versions.length === 2) {
    let [v0, v1] = versions as [LV, LV]
    if (v0 === v1) {
      cb(v0, true)
      cb(v0, false)
    } else {
      if (v0 > v1) [v0, v1] = [v1, v0]
      cb(v1, true)
      cb(v0, !versionContainsLV(cg, [v1], v0))
    }
    return
  }

  // キューにはバージョンを2倍してエンコード（偶数=入力、奇数=親）
  const queue = new PriorityQueue<number>((a, b) => b - a)
  for (const v of versions) queue.push(v * 2)

  let inputsRemaining = versions.length

  while (queue.size > 0 && inputsRemaining > 0) {
    const vEnc = queue.pop()!
    const isInput = vEnc % 2 === 0
    const v = vEnc >> 1

    if (isInput) {
      cb(v, true)
      inputsRemaining -= 1
    }

    const e = findEntryContainingRaw(cg, v)

    // このエントリ内のキューアイテムをクリア
    while (!queue.isEmpty() && queue.peek()! >= e.version * 2) {
      const v2Enc = queue.pop()!
      const isInput2 = v2Enc % 2 === 0
      if (isInput2) {
        cb(v2Enc >> 1, false)
        inputsRemaining -= 1
      }
    }

    for (const p of e.parents) {
      queue.push(p * 2 + 1)
    }
  }
}

/** ドミネーターを検出して配列で返す */
export function findDominators(cg: CausalGraph, versions: LV[]): LV[] {
  if (versions.length <= 1) return versions
  const result: LV[] = []
  findDominators2(cg, versions, (v, isDominator) => {
    if (isDominator) result.push(v)
  })
  return result.reverse()
}

// ===== findConflicting =====

/** タイムポイント（findConflictingの内部型） */
interface TimePoint {
  v: LV[]
  flag: DiffFlag
}

const pointFromVersions = (v: LV[], flag: DiffFlag): TimePoint => ({
  v: v.length <= 1 ? v : v.slice().sort((a, b) => b - a),
  flag,
})

/**
 * 2つのバージョン間の競合バージョン範囲を検出する。
 * 共通祖先のバージョンを返す。
 */
export function findConflicting(
  cg: CausalGraph,
  a: LV[],
  b: LV[],
  visit: (range: LVRange, flag: DiffFlag) => void,
): LV[] {
  // 最大ヒープ: 最大バージョンが先に出るよう比較を反転
  const queue = new PriorityQueue<TimePoint>((a, b) => {
    for (let i = 0; i < a.v.length; i++) {
      if (b.v.length <= i) return -1
      const c = b.v[i]! - a.v[i]!
      if (c !== 0) return c
    }
    if (a.v.length < b.v.length) return 1
    return a.flag - b.flag
  })

  queue.push(pointFromVersions(a, DiffFlagOnlyA))
  queue.push(pointFromVersions(b, DiffFlagOnlyB))

  while (true) {
    const popped = queue.pop()!
    const v = popped.v
    let flag = popped.flag
    if (v.length === 0) return []

    // 重複エントリを除去
    while (!queue.isEmpty()) {
      const { v: peekV, flag: peekFlag } = queue.peek()!
      if (lvEq(v, peekV)) {
        if (peekFlag !== flag) flag = DiffFlagShared
        queue.pop()
      } else break
    }

    if (queue.isEmpty()) return v.reverse()

    // マージノードを分割
    if (v.length > 1) {
      for (let i = 1; i < v.length; i++) {
        queue.push({ v: [v[i]!], flag })
      }
    }

    const t = v[0]!
    const containingTxn = findEntryContainingRaw(cg, t)
    const txnStart = containingTxn.version
    let end = t + 1

    // このトランザクション内の他の変更を消費
    while (true) {
      if (queue.isEmpty()) {
        return [end - 1]
      } else {
        const { v: peekV, flag: peekFlag } = queue.peek()!

        if (peekV.length >= 1 && peekV[0]! >= txnStart) {
          queue.pop()

          const peekLast = peekV[0]!

          if (peekLast + 1 < end) {
            visit([peekLast + 1, end], flag)
            end = peekLast + 1
          }

          if (peekFlag !== flag) flag = DiffFlagShared

          if (peekV.length > 1) {
            for (let i = 1; i < peekV.length; i++) {
              queue.push({ v: [peekV[i]!], flag: peekFlag })
            }
          }
        } else {
          visit([txnStart, end], flag)
          queue.push(pointFromVersions(containingTxn.parents, flag))
          break
        }
      }
    }
  }
}

// ===== compareVersions =====

/**
 * 2つのバージョンの関係を判定する。
 * -1: a < b（aがbの祖先）
 *  1: b < a（bがaの祖先）
 *  0: 並行
 *
 * 注意: a === b の場合は呼び出し側でチェックすること
 */
export const compareVersions = (
  cg: CausalGraph,
  a: LV,
  b: LV,
): number => {
  if (a > b) {
    return versionContainsLV(cg, [a], b) ? -1 : 0
  } else if (a < b) {
    return versionContainsLV(cg, [b], a) ? 1 : 0
  }
  throw new Error('aとbが等しい')
}

// ===== シリアライズ =====

/** 部分シリアライズされたCGエントリ */
export interface PartialSerializedCGEntry {
  agent: string
  seq: number
  len: number
  parents: RawVersion[]
}

export type PartialSerializedCG = PartialSerializedCGEntry[]

/** 指定範囲のCGエントリをシリアライズする */
export function serializeDiff(
  cg: CausalGraph,
  ranges: LVRange[],
): PartialSerializedCG {
  const entries: PartialSerializedCGEntry[] = []
  for (const [rangeStart, end] of ranges) {
    let start = rangeStart
    while (start !== end) {
      const [e, offset] = findEntryContaining(cg, start)
      const localEnd = min2(end, e.vEnd)
      const len = localEnd - start
      const parents: RawVersion[] =
        offset === 0
          ? lvToRawList(cg, e.parents)
          : [[e.agent, e.seq + offset - 1]]

      entries.push({ agent: e.agent, seq: e.seq + offset, len, parents })
      start += len
    }
  }
  return entries
}

/** 指定バージョンからの差分をシリアライズする */
export function serializeFromVersion(
  cg: CausalGraph,
  v: LV[],
): PartialSerializedCG {
  const ranges = diff(cg, v, cg.heads).bOnly
  return serializeDiff(cg, ranges)
}

/** シリアライズされたCGエントリをマージする */
export function mergePartialVersions(
  cg: CausalGraph,
  data: PartialSerializedCG,
): LVRange {
  const start = nextLV(cg)

  for (const { agent, seq, len, parents } of data) {
    addRaw(cg, [agent, seq], len, parents)
  }
  return [start, nextLV(cg)]
}

// ===== intersectWithSummary =====

type IntersectVisitor = (
  agent: string,
  startSeq: number,
  endSeq: number,
  version: number,
) => void

/**
 * VersionSummaryとの交差を計算する（内部実装）
 */
const intersectWithSummaryFull = (
  cg: CausalGraph,
  summary: VersionSummary,
  visit: IntersectVisitor,
): void => {
  for (const agent in summary) {
    const ranges = summary[agent]!
    const clientEntries = cg.agentToVersion[agent]

    for (const [rangeStartSeq, endSeq] of ranges) {
      let startSeq = rangeStartSeq
      if (clientEntries != null) {
        let idx = binarySearch(clientEntries, (entry) =>
          startSeq < entry.seq ? -1 : startSeq >= entry.seqEnd ? 1 : 0,
        )

        if (idx < 0) idx = -idx - 1

        for (; idx < clientEntries.length; idx++) {
          const ce = clientEntries[idx]!
          if (ce.seq >= endSeq) break

          if (ce.seq > startSeq) {
            visit(agent, startSeq, ce.seq, -1)
            startSeq = ce.seq
          }

          const seqOffset = startSeq - ce.seq
          const versionStart = ce.version + seqOffset
          const localSeqEnd = min2(ce.seqEnd, endSeq)

          visit(agent, startSeq, localSeqEnd, versionStart)
          startSeq = localSeqEnd
        }
      }

      if (startSeq < endSeq) visit(agent, startSeq, endSeq, -1)
    }
  }
}

/**
 * VersionSummaryとの交差を計算し、共通バージョンと残差を返す。
 */
export const intersectWithSummary = (
  cg: CausalGraph,
  summary: VersionSummary,
  versionsIn: LV[] = [],
): [LV[], VersionSummary | null] => {
  let remainder: null | VersionSummary = null

  const versions = versionsIn.slice()
  intersectWithSummaryFull(cg, summary, (agent, startSeq, endSeq, versionStart) => {
    if (versionStart >= 0) {
      const versionEnd = versionStart + (endSeq - startSeq)
      eachVersionBetween(cg, versionStart, versionEnd, (_e, _vs, ve) => {
        const vLast = ve - 1
        versions.push(vLast)
      })
    } else {
      if (remainder == null) remainder = {}
      const a = (remainder[agent] ??= [])
      a.push([startSeq, endSeq])
    }
  })

  return [findDominators(cg, versions), remainder]
}
