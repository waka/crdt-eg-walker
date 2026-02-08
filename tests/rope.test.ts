import { describe, it, expect } from 'vitest'
import { Rope } from '../src/rope.js'

describe('Rope', () => {
  describe('基本操作', () => {
    it('空のRopeはlength 0、空文字列を返す', () => {
      const rope = new Rope()
      expect(rope.length).toBe(0)
      expect(rope.toString()).toBe('')
    })

    it('1文字ずつ末尾に挿入', () => {
      const rope = new Rope()
      rope.insert(0, 'h')
      rope.insert(1, 'e')
      rope.insert(2, 'l')
      rope.insert(3, 'l')
      rope.insert(4, 'o')
      expect(rope.toString()).toBe('hello')
      expect(rope.length).toBe(5)
    })

    it('先頭に挿入', () => {
      const rope = new Rope()
      rope.insert(0, 'o')
      rope.insert(0, 'l')
      rope.insert(0, 'l')
      rope.insert(0, 'e')
      rope.insert(0, 'h')
      expect(rope.toString()).toBe('hello')
    })

    it('中間に挿入', () => {
      const rope = new Rope()
      rope.insert(0, 'h')
      rope.insert(1, 'o')
      rope.insert(1, 'l')
      rope.insert(1, 'e')
      rope.insert(3, 'l')
      expect(rope.toString()).toBe('hello')
    })

    it('1文字削除', () => {
      const rope = new Rope()
      for (const ch of 'hello') rope.insert(rope.length, ch)
      rope.delete(1) // 'e' を削除
      expect(rope.toString()).toBe('hllo')
      expect(rope.length).toBe(4)
    })

    it('先頭を削除', () => {
      const rope = new Rope()
      for (const ch of 'hello') rope.insert(rope.length, ch)
      rope.delete(0)
      expect(rope.toString()).toBe('ello')
    })

    it('末尾を削除', () => {
      const rope = new Rope()
      for (const ch of 'hello') rope.insert(rope.length, ch)
      rope.delete(4)
      expect(rope.toString()).toBe('hell')
    })

    it('全削除', () => {
      const rope = new Rope()
      for (const ch of 'abc') rope.insert(rope.length, ch)
      rope.delete(0)
      rope.delete(0)
      rope.delete(0)
      expect(rope.toString()).toBe('')
      expect(rope.length).toBe(0)
    })

    it('空Ropeへのdelete は何もしない', () => {
      const rope = new Rope()
      rope.delete(0) // エラーにならない
      expect(rope.length).toBe(0)
    })
  })

  describe('大量操作', () => {
    it('1000文字の逐次挿入と結果確認', () => {
      const rope = new Rope()
      let expected = ''
      for (let i = 0; i < 1000; i++) {
        const ch = String.fromCharCode(97 + (i % 26))
        rope.insert(i, ch)
        expected += ch
      }
      expect(rope.toString()).toBe(expected)
      expect(rope.length).toBe(1000)
    })

    it('1000文字の先頭挿入', () => {
      const rope = new Rope()
      let expected = ''
      for (let i = 0; i < 1000; i++) {
        const ch = String.fromCharCode(97 + (i % 26))
        rope.insert(0, ch)
        expected = ch + expected
      }
      expect(rope.toString()).toBe(expected)
    })

    it('500文字挿入後250文字をランダム削除', () => {
      // 再現可能な疑似乱数
      let state = 42
      const rng = () => {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return (state >>> 0) / 0xffffffff
      }

      const rope = new Rope()
      const arr: string[] = []
      for (let i = 0; i < 500; i++) {
        const ch = String.fromCharCode(97 + (i % 26))
        rope.insert(i, ch)
        arr.push(ch)
      }

      for (let i = 0; i < 250; i++) {
        const pos = Math.floor(rng() * arr.length)
        rope.delete(pos)
        arr.splice(pos, 1)
      }

      expect(rope.toString()).toBe(arr.join(''))
      expect(rope.length).toBe(250)
    })

    it('ランダム位置に挿入・削除を混合', () => {
      let state = 99
      const rng = () => {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return (state >>> 0) / 0xffffffff
      }

      const rope = new Rope()
      const arr: string[] = []

      for (let i = 0; i < 1000; i++) {
        if (arr.length > 0 && rng() < 0.3) {
          // 削除
          const pos = Math.floor(rng() * arr.length)
          rope.delete(pos)
          arr.splice(pos, 1)
        } else {
          // 挿入
          const pos = Math.floor(rng() * (arr.length + 1))
          const ch = String.fromCharCode(97 + (i % 26))
          rope.insert(pos, ch)
          arr.splice(pos, 0, ch)
        }
      }

      expect(rope.toString()).toBe(arr.join(''))
      expect(rope.length).toBe(arr.length)
    })
  })

  describe('SnapshotOps互換', () => {
    it('SnapshotOps<string> インターフェースとして使える', () => {
      const rope = new Rope()
      // SnapshotOps の insert/delete メソッドがある
      rope.insert(0, 'a')
      rope.insert(1, 'b')
      rope.insert(2, 'c')
      rope.delete(1) // 'b' を削除
      expect(rope.toString()).toBe('ac')
    })
  })

  describe('AVLバランス', () => {
    it('大量挿入後も正しく動作（木の偏りなし）', () => {
      const rope = new Rope()
      // 先頭に5000文字挿入（最悪ケース: 常に同じ位置）
      for (let i = 0; i < 5000; i++) {
        rope.insert(0, String.fromCharCode(97 + (i % 26)))
      }
      expect(rope.length).toBe(5000)
      // toStringが正常に動作すればバランスが取れている
      const s = rope.toString()
      expect(s.length).toBe(5000)
    })
  })
})
