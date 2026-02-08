import { describe, it, expect } from 'vitest'
import { OrderStatisticTree } from '../src/order-statistic-tree.js'
import type { Item } from '../src/types.js'
import { ItemState } from '../src/types.js'

function makeItem(opId: number, curState: ItemState, endState: ItemState): Item {
  return {
    opId,
    curState,
    endState,
    originLeft: -1,
    rightParent: -1,
  }
}

describe('OrderStatisticTree', () => {
  describe('基本操作', () => {
    it('空の木はlength 0', () => {
      const tree = new OrderStatisticTree()
      expect(tree.length).toBe(0)
    })

    it('push でアイテムを追加', () => {
      const tree = new OrderStatisticTree()
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(1, ItemState.Inserted, ItemState.Inserted))
      expect(tree.length).toBe(2)
    })

    it('insertAt で指定位置にアイテムを挿入', () => {
      const tree = new OrderStatisticTree()
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(2, ItemState.Inserted, ItemState.Inserted))
      tree.insertAt(1, makeItem(1, ItemState.Inserted, ItemState.Inserted))

      expect(tree.length).toBe(3)
      expect(tree.getByIndex(0)!.opId).toBe(0)
      expect(tree.getByIndex(1)!.opId).toBe(1)
      expect(tree.getByIndex(2)!.opId).toBe(2)
    })

    it('getByIndex で正しいアイテムを取得', () => {
      const tree = new OrderStatisticTree()
      for (let i = 0; i < 10; i++) {
        tree.push(makeItem(i, ItemState.Inserted, ItemState.Inserted))
      }
      for (let i = 0; i < 10; i++) {
        expect(tree.getByIndex(i)!.opId).toBe(i)
      }
      expect(tree.getByIndex(10)).toBeNull()
    })

    it('toArray で全アイテムを順序通り取得', () => {
      const tree = new OrderStatisticTree()
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(1, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(2, ItemState.Inserted, ItemState.Inserted))

      const arr = tree.toArray()
      expect(arr.map(i => i.opId)).toEqual([0, 1, 2])
    })
  })

  describe('findByCurPos', () => {
    it('全てInsertedの場合、targetPosに対応する位置を返す', () => {
      const tree = new OrderStatisticTree()
      for (let i = 0; i < 5; i++) {
        tree.push(makeItem(i, ItemState.Inserted, ItemState.Inserted))
      }

      // targetPos=0 → 先頭
      expect(tree.findByCurPos(0)).toEqual({ idx: 0, endPos: 0 })
      // targetPos=1 → 2番目
      expect(tree.findByCurPos(1)).toEqual({ idx: 1, endPos: 1 })
      // targetPos=3 → 4番目
      expect(tree.findByCurPos(3)).toEqual({ idx: 3, endPos: 3 })
      // targetPos=5 → 末尾の次
      expect(tree.findByCurPos(5)).toEqual({ idx: 5, endPos: 5 })
    })

    it('NYIアイテムをスキップする', () => {
      const tree = new OrderStatisticTree()
      // [INS, NYI, INS, NYI, INS]
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(1, ItemState.NotYetInserted, ItemState.NotYetInserted))
      tree.push(makeItem(2, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(3, ItemState.NotYetInserted, ItemState.NotYetInserted))
      tree.push(makeItem(4, ItemState.Inserted, ItemState.Inserted))

      // targetPos=0 → idx=0 (先頭)
      expect(tree.findByCurPos(0)).toEqual({ idx: 0, endPos: 0 })
      // targetPos=1 → idx=1はNYIなのでスキップ、idx=1の位置でcurPos=1
      expect(tree.findByCurPos(1)).toEqual({ idx: 1, endPos: 1 })
      // targetPos=2 → INS(0)=1, NYI(1)=skip, INS(2)=2 → idx=3
      expect(tree.findByCurPos(2)).toEqual({ idx: 3, endPos: 2 })
    })

    it('削除済みアイテムをスキップする', () => {
      const tree = new OrderStatisticTree()
      // [INS, DEL, INS]
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(1, ItemState.Deleted, ItemState.Deleted))
      tree.push(makeItem(2, ItemState.Inserted, ItemState.Inserted))

      // targetPos=0 → idx=0
      expect(tree.findByCurPos(0)).toEqual({ idx: 0, endPos: 0 })
      // targetPos=1: INS(0)のcurState=INS → curPos=1 → ループ終了
      // idx=1, endPos=1（INS(0)のendState=INSをカウント）
      expect(tree.findByCurPos(1)).toEqual({ idx: 1, endPos: 1 })
    })
  })

  describe('refreshCountsAt', () => {
    it('状態変更後にカウンタが正しく更新される', () => {
      const tree = new OrderStatisticTree()
      tree.push(makeItem(0, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(1, ItemState.Inserted, ItemState.Inserted))
      tree.push(makeItem(2, ItemState.Inserted, ItemState.Inserted))

      // アイテム1をNYIに変更（retreatのシミュレーション）
      // endStateは変わらない（INSのまま）
      const item = tree.getByIndex(1)!
      item.curState = ItemState.NotYetInserted
      tree.refreshCountsAt(1)

      // targetPos=1: INS(0)のcurState=INSでcurPos=1 → ループ終了
      // idx=1, endPos=1（INS(0)のendState=INSをカウント）
      expect(tree.findByCurPos(1)).toEqual({ idx: 1, endPos: 1 })
      // targetPos=2: INS(0)=1, NYI(1)はスキップ, INS(2)=2 → idx=3
      // endPos: INS(0)=1, NYI(1)のendState=INS→2, INS(2)のendState=INS→3
      expect(tree.findByCurPos(2)).toEqual({ idx: 3, endPos: 3 })
    })
  })

  describe('大量データ', () => {
    it('1000アイテムの挿入と取得', () => {
      const tree = new OrderStatisticTree()
      for (let i = 0; i < 1000; i++) {
        tree.push(makeItem(i, ItemState.Inserted, ItemState.Inserted))
      }
      expect(tree.length).toBe(1000)

      for (let i = 0; i < 1000; i++) {
        expect(tree.getByIndex(i)!.opId).toBe(i)
      }
    })

    it('ランダム位置への挿入', () => {
      let state = 42
      const rng = () => {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return (state >>> 0) / 0xffffffff
      }

      const tree = new OrderStatisticTree()
      const arr: Item[] = []

      for (let i = 0; i < 500; i++) {
        const item = makeItem(i, ItemState.Inserted, ItemState.Inserted)
        const pos = Math.floor(rng() * (arr.length + 1))
        tree.insertAt(pos, item)
        arr.splice(pos, 0, item)
      }

      expect(tree.length).toBe(500)
      for (let i = 0; i < 500; i++) {
        expect(tree.getByIndex(i)!.opId).toBe(arr[i]!.opId)
      }
    })
  })
})
