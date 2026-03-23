import { describe, it, expect, vi } from 'vitest'
import { InMemoryProvider } from '../src/provider.js'
import { encodeOpLog, decodeOpLog } from '../src/encoding.js'
import { createOpLog, localInsert } from '../src/oplog.js'

describe('InMemoryProvider', () => {
  it('connect/disconnect イベントが発火する', () => {
    const provider = new InMemoryProvider()
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()

    provider.on('connect', onConnect)
    provider.on('disconnect', onDisconnect)

    provider.connect()
    expect(onConnect).toHaveBeenCalledOnce()

    provider.disconnect()
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it('off でイベントハンドラを解除できる', () => {
    const provider = new InMemoryProvider()
    const onConnect = vi.fn()

    provider.on('connect', onConnect)
    provider.off('connect', onConnect)
    provider.connect()

    expect(onConnect).not.toHaveBeenCalled()
  })

  it('ピア間で op を転送する', () => {
    const providerA = new InMemoryProvider()
    const providerB = new InMemoryProvider()
    providerA.connectPeer(providerB)

    providerA.connect()
    providerB.connect()

    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'h', 'i')
    const data = encodeOpLog(oplog)

    const receivedByB = vi.fn()
    providerB.on('op', receivedByB)

    providerA.sendOp(data)

    expect(receivedByB).toHaveBeenCalledOnce()
    const received = receivedByB.mock.calls[0][0] as Uint8Array
    const decoded = decodeOpLog<string>(received)
    expect(decoded.ops.length).toBe(2)
  })

  it('disconnect 後は op を転送しない', () => {
    const providerA = new InMemoryProvider()
    const providerB = new InMemoryProvider()
    providerA.connectPeer(providerB)

    providerA.connect()
    providerB.connect()
    providerA.disconnect()

    const received = vi.fn()
    providerB.on('op', received)

    const data = encodeOpLog(createOpLog())
    providerA.sendOp(data)

    expect(received).not.toHaveBeenCalled()
  })

  it('disconnectPeer でピア接続を解除できる', () => {
    const providerA = new InMemoryProvider()
    const providerB = new InMemoryProvider()
    providerA.connectPeer(providerB)

    providerA.connect()
    providerB.connect()
    providerA.disconnectPeer(providerB)

    const received = vi.fn()
    providerB.on('op', received)

    const data = encodeOpLog(createOpLog())
    providerA.sendOp(data)

    expect(received).not.toHaveBeenCalled()
  })

  it('3クライアント間で op を転送できる', () => {
    const a = new InMemoryProvider()
    const b = new InMemoryProvider()
    const c = new InMemoryProvider()
    a.connectPeer(b)
    b.connectPeer(c)

    a.connect()
    b.connect()
    c.connect()

    const receivedByB = vi.fn()
    const receivedByC = vi.fn()
    b.on('op', receivedByB)
    c.on('op', receivedByC)

    const oplog = createOpLog<string>()
    localInsert(oplog, 'A', 0, 'x')
    a.sendOp(encodeOpLog(oplog))

    // a → b には届く（ピア接続あり）
    expect(receivedByB).toHaveBeenCalledOnce()
    // a → c は直接ピア接続がないので届かない
    expect(receivedByC).not.toHaveBeenCalled()
  })
})
