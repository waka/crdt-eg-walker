/**
 * ブランチ操作
 *
 * checkout, mergeChangesIntoBranch などの文書スナップショット管理。
 */

import { diff, isFastForward, findConflicting, findDominators } from './causal-graph-utils.js'
import { traverseAndApply, createEditContext } from './edit-context.js'
import { ItemState } from './types.js'
import type {
  LV,
  LVRange,
  Item,
  EditContext,
  DiffFlag,
  Branch,
  ListOpLog,
} from './types.js'

// DiffFlagの値
const DiffFlagOnlyB: DiffFlag = 1 as DiffFlag

/** 空のブランチを作成 */
export function createEmptyBranch<T = string>(): Branch<T> {
  return { snapshot: [], version: [] }
}

/** OpLogから全操作を適用してブランチを作成 */
export function checkout<T>(oplog: ListOpLog<T>): Branch<T> {
  const ctx = createEditContext(oplog.ops.length)
  const snapshot: T[] = []
  traverseAndApply(ctx, oplog, snapshot)

  return {
    snapshot,
    version: oplog.cg.heads.slice(),
  }
}

/** OpLogから全操作を適用してスナップショットを返す */
export function checkoutSimple<T>(oplog: ListOpLog<T>): T[] {
  return checkout(oplog).snapshot
}

/** OpLogから全操作を適用して文字列を返す */
export function checkoutSimpleString(
  oplog: ListOpLog<string>,
): string {
  return checkoutSimple(oplog).join('')
}

/**
 * fast-forward可能な場合に直接スナップショットに操作を適用する高速パス。
 * EditContext、プレースホルダー、diff計算をすべてスキップする。
 */
function applyFastForward<T>(
  branch: Branch<T>,
  oplog: ListOpLog<T>,
  mergeVersion: LV[],
): void {
  const ranges = diff(oplog.cg, branch.version, mergeVersion).bOnly
  for (const [start, end] of ranges) {
    for (let lv = start; lv < end; lv++) {
      const op = oplog.ops[lv]!
      if (op.type === 'ins') {
        branch.snapshot.splice(op.pos, 0, op.content)
      } else {
        branch.snapshot.splice(op.pos, 1)
      }
    }
  }
  branch.version = findDominators(oplog.cg, [
    ...branch.version,
    ...mergeVersion,
  ])
}

/**
 * 既存のブランチに新しい変更をマージする。
 *
 * 1. fast-forward可能ならEditContextなしで直接適用（高速パス）
 * 2. そうでなければ共通祖先を見つけて通常パスで処理
 */
export function mergeChangesIntoBranch<T>(
  branch: Branch<T>,
  oplog: ListOpLog<T>,
  mergeVersion: LV[] = oplog.cg.heads,
): void {
  // 高速パス: ブランチからmergeVersionへfast-forward可能な場合
  if (isFastForward(oplog.cg, branch.version, mergeVersion)) {
    applyFastForward(branch, oplog, mergeVersion)
    return
  }

  const newOps: LVRange[] = []
  const conflictOps: LVRange[] = []

  const commonAncestor = findConflicting(
    oplog.cg,
    branch.version,
    mergeVersion,
    (span, flag) => {
      // visitは逆順で呼ばれる
      const target = flag === DiffFlagOnlyB ? newOps : conflictOps

      let last: LVRange | undefined
      if (
        target.length > 0 &&
        (last = target[target.length - 1]!) &&
        last[0] === span[1]
      ) {
        last[0] = span[0]
      } else {
        target.push(span)
      }
    },
  )

  // 逆順で構築されたので反転
  newOps.reverse()
  conflictOps.reverse()

  const ctx: EditContext = {
    items: [],
    delTargets: new Array<number>(oplog.ops.length).fill(-1),
    itemsByLV: new Array<Item | null>(oplog.ops.length).fill(null),
    curVersion: commonAncestor,
    _cursorHint: null,
  }

  // 共通祖先時点のプレースホルダーアイテムを作成
  const placeholderLength =
    branch.version.length === 0
      ? 0
      : Math.max(...branch.version) + 1
  const PLACEHOLDER_OFFSET = 1e12

  for (let i = 0; i < placeholderLength; i++) {
    const opId = i + PLACEHOLDER_OFFSET
    const item: Item = {
      opId,
      curState: ItemState.Inserted,
      endState: ItemState.Inserted,
      originLeft: -1,
      rightParent: -1,
    }
    ctx.items.push(item)
    ctx.itemsByLV[opId] = item
  }

  // 競合する操作を再生（スナップショットは変更しない）
  for (const [start, end] of conflictOps) {
    traverseAndApply(ctx, oplog, null, start, end)
  }

  // 新しい操作を適用（スナップショットを更新）
  for (const [start, end] of newOps) {
    traverseAndApply(ctx, oplog, branch.snapshot, start, end)
  }

  // バージョンを更新
  branch.version = findDominators(oplog.cg, [
    ...branch.version,
    ...mergeVersion,
  ])
}
