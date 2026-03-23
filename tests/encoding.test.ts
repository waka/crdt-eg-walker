import { describe, it, expect } from 'vitest'
import { encodeOpLog, decodeOpLog, encodeMessage, decodeMessage } from '../src/encoding.js'
import { createOpLog, localInsert, localDelete } from '../src/oplog.js'

describe('encodeOpLog / decodeOpLog', () => {
  it('空の OpLog をエンコード/デコードできる', () => {
    const oplog = createOpLog()
    const encoded = encodeOpLog(oplog)
    expect(encoded).toBeInstanceOf(Uint8Array)

    const decoded = decodeOpLog(encoded)
    expect(decoded.ops).toEqual([])
    expect(decoded.cg.heads).toEqual([])
    expect(decoded.cg.entries).toEqual([])
  })

  it('挿入操作をエンコード/デコードできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')

    const encoded = encodeOpLog(oplog)
    const decoded = decodeOpLog<string>(encoded)

    expect(decoded.ops.length).toBe(5)
    expect(decoded.ops[0]).toEqual({ type: 'ins', pos: 0, content: 'h' })
    expect(decoded.ops[4]).toEqual({ type: 'ins', pos: 4, content: 'o' })
    expect(decoded.cg.heads).toEqual([4])
  })

  it('削除操作をエンコード/デコードできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 2)

    const encoded = encodeOpLog(oplog)
    const decoded = decodeOpLog<string>(encoded)

    expect(decoded.ops.length).toBe(6)
    expect(decoded.ops[5]).toEqual({ type: 'del', pos: 2 })
  })

  it('複数エージェントの操作をエンコード/デコードできる', () => {
    const oplogA = createOpLog<string>()
    const oplogB = createOpLog<string>()
    localInsert(oplogA, 'A', 0, 'a', 'b', 'c')
    localInsert(oplogB, 'B', 0, 'x', 'y')

    const encoded = encodeOpLog(oplogA)
    const decoded = decodeOpLog<string>(encoded)

    expect(decoded.cg.agentToVersion).toHaveProperty('A')
    expect(Object.keys(decoded.cg.agentToVersion)).toContain('A')
  })

  it('ラウンドトリップで因果グラフが保持される', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'e', 'l', 'l', 'o')
    localDelete(oplog, 'A', 2)

    const decoded = decodeOpLog(encodeOpLog(oplog))

    expect(decoded.cg.entries.length).toBe(oplog.cg.entries.length)
    expect(decoded.cg.heads).toEqual(oplog.cg.heads)
  })
})

describe('encodeMessage / decodeMessage', () => {
  it('op メッセージをエンコード/デコードできる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')
    const opData = encodeOpLog(oplog)

    const encoded = encodeMessage({ type: 'op', data: opData })
    expect(encoded).toBeInstanceOf(Uint8Array)

    const decoded = decodeMessage(encoded)
    expect(decoded.type).toBe('op')
    if (decoded.type === 'op') {
      const oplog2 = decodeOpLog<string>(decoded.data)
      expect(oplog2.ops.length).toBe(2)
    }
  })

  it('awareness メッセージをエンコード/デコードできる', () => {
    type State = { cursor: number; name: string }
    const state: State = { cursor: 5, name: 'Alice' }

    const encoded = encodeMessage<State>({ type: 'awareness', clientId: 'client-A', data: state })
    expect(encoded).toBeInstanceOf(Uint8Array)

    const decoded = decodeMessage<State>(encoded)
    expect(decoded.type).toBe('awareness')
    if (decoded.type === 'awareness') {
      expect(decoded.clientId).toBe('client-A')
      expect(decoded.data).toEqual(state)
    }
  })

  it('op と awareness を同一チャンネルで区別できる', () => {
    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'x')

    const opMsg = encodeMessage({ type: 'op', data: encodeOpLog(oplog) })
    const awareMsg = encodeMessage({ type: 'awareness', clientId: 'A', data: { cursor: 0 } })

    // 受信側でタイプを判別できる
    const d1 = decodeMessage(opMsg)
    const d2 = decodeMessage(awareMsg)

    expect(d1.type).toBe('op')
    expect(d2.type).toBe('awareness')
  })
})
