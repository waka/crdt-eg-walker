import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Awareness, HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT } from '../src/awareness.js'

type TestState = {
  cursor: number
  name: string
}

describe('Awareness: 状態管理', () => {
  it('初期状態は空', () => {
    const a = new Awareness<TestState>()
    expect(a.getStates().size).toBe(0)
  })

  it('setLocalState で状態を登録できる', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('client-A', { cursor: 5, name: 'Alice' })

    const states = a.getStates()
    expect(states.size).toBe(1)
    expect(states.get('client-A')).toEqual({ cursor: 5, name: 'Alice' })
  })

  it('applyRemoteState でリモート状態を反映できる', () => {
    const a = new Awareness<TestState>()
    a.applyRemoteState('client-B', { cursor: 10, name: 'Bob' })

    expect(a.getState('client-B')).toEqual({ cursor: 10, name: 'Bob' })
  })

  it('同じ clientId への上書きは最新値になる（Last-Write-Wins）', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('client-A', { cursor: 5, name: 'Alice' })
    a.setLocalState('client-A', { cursor: 7, name: 'Alice' })

    expect(a.getState('client-A')?.cursor).toBe(7)
  })

  it('removeState で状態を削除できる', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('client-A', { cursor: 5, name: 'Alice' })
    a.removeState('client-A')

    expect(a.getStates().size).toBe(0)
    expect(a.getState('client-A')).toBeUndefined()
  })

  it('存在しない clientId の removeState は何もしない', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('client-A', { cursor: 5, name: 'Alice' })
    a.removeState('client-Z')  // 存在しない

    expect(a.getStates().size).toBe(1)
  })

  it('getStates はスナップショットを返す（変更が反映されない）', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('client-A', { cursor: 5, name: 'Alice' })
    const snapshot = a.getStates()

    a.setLocalState('client-B', { cursor: 10, name: 'Bob' })

    // スナップショット取得後の変更は反映されない
    expect(snapshot.size).toBe(1)
    expect(a.getStates().size).toBe(2)
  })

  it('複数クライアントの状態を保持できる', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('A', { cursor: 0, name: 'Alice' })
    a.setLocalState('B', { cursor: 5, name: 'Bob' })
    a.applyRemoteState('C', { cursor: 10, name: 'Carol' })

    const states = a.getStates()
    expect(states.size).toBe(3)
    expect(states.get('B')?.name).toBe('Bob')
  })
})

describe('Awareness: イベント', () => {
  it('setLocalState で change イベントが発火する', () => {
    const a = new Awareness<TestState>()
    const handler = vi.fn()
    a.on('change', handler)

    a.setLocalState('A', { cursor: 1, name: 'Alice' })
    expect(handler).toHaveBeenCalledOnce()

    const states = handler.mock.calls[0][0] as Map<string, TestState>
    expect(states.get('A')?.cursor).toBe(1)
  })

  it('applyRemoteState で change イベントが発火する', () => {
    const a = new Awareness<TestState>()
    const handler = vi.fn()
    a.on('change', handler)

    a.applyRemoteState('B', { cursor: 3, name: 'Bob' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('removeState で change イベントが発火する', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('A', { cursor: 0, name: 'Alice' })

    const handler = vi.fn()
    a.on('change', handler)
    a.removeState('A')

    expect(handler).toHaveBeenCalledOnce()
    expect((handler.mock.calls[0][0] as Map<string, TestState>).size).toBe(0)
  })

  it('存在しない clientId の removeState は change を発火しない', () => {
    const a = new Awareness<TestState>()
    const handler = vi.fn()
    a.on('change', handler)

    a.removeState('nonexistent')
    expect(handler).not.toHaveBeenCalled()
  })

  it('off でイベントハンドラを解除できる', () => {
    const a = new Awareness<TestState>()
    const handler = vi.fn()
    a.on('change', handler)
    a.off('change', handler)

    a.setLocalState('A', { cursor: 0, name: 'Alice' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('複数のハンドラを登録できる', () => {
    const a = new Awareness<TestState>()
    const h1 = vi.fn()
    const h2 = vi.fn()
    a.on('change', h1)
    a.on('change', h2)

    a.setLocalState('A', { cursor: 0, name: 'Alice' })
    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('change ハンドラに渡される Map は最新の全状態を含む', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('A', { cursor: 0, name: 'Alice' })

    let receivedStates: Map<string, TestState> | null = null
    a.on('change', (states) => { receivedStates = states })

    a.setLocalState('B', { cursor: 5, name: 'Bob' })

    expect(receivedStates!.size).toBe(2)
    expect(receivedStates!.get('A')?.name).toBe('Alice')
    expect(receivedStates!.get('B')?.name).toBe('Bob')
  })
})

describe('Awareness: ハートビート', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('startHeartbeat で broadcast が定期的に呼ばれる', () => {
    const a = new Awareness<TestState>()
    const broadcast = vi.fn()
    const getState = vi.fn(() => ({ cursor: 0, name: 'Alice' }))

    a.setLocalState('A', { cursor: 0, name: 'Alice' })
    a.startHeartbeat('A', getState, broadcast, { interval: 1000, timeout: 5000 })

    vi.advanceTimersByTime(3000)
    expect(broadcast).toHaveBeenCalledTimes(3)

    a.stopHeartbeat()
  })

  it('stopHeartbeat でブロードキャストが停止する', () => {
    const a = new Awareness<TestState>()
    const broadcast = vi.fn()

    a.startHeartbeat(
      'A',
      () => ({ cursor: 0, name: 'Alice' }),
      broadcast,
      { interval: 1000, timeout: 5000 },
    )

    vi.advanceTimersByTime(2000)
    a.stopHeartbeat()
    vi.advanceTimersByTime(3000)

    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('タイムアウトしたリモートクライアントが削除される', () => {
    const a = new Awareness<TestState>()
    const handler = vi.fn()
    a.on('change', handler)

    // リモートクライアントを追加
    a.applyRemoteState('B', { cursor: 5, name: 'Bob' })
    handler.mockClear()

    // ハートビート開始（interval=1s, timeout=3s）
    a.startHeartbeat(
      'A',
      () => ({ cursor: 0, name: 'Alice' }),
      () => {},
      { interval: 1000, timeout: 3000 },
    )

    // 3秒未満では削除されない
    vi.advanceTimersByTime(2000)
    expect(a.getState('B')).toBeDefined()

    // 4秒後（timeout超過）: B が削除される
    vi.advanceTimersByTime(2000)
    expect(a.getState('B')).toBeUndefined()
    expect(handler).toHaveBeenCalled()

    a.stopHeartbeat()
  })

  it('applyRemoteState で lastSeen が更新され、タイムアウトが延長される', () => {
    const a = new Awareness<TestState>()

    a.applyRemoteState('B', { cursor: 5, name: 'Bob' })
    a.startHeartbeat(
      'A',
      () => ({ cursor: 0, name: 'Alice' }),
      () => {},
      { interval: 1000, timeout: 3000 },
    )

    // 2秒後にリモートから更新が来る（lastSeen がリフレッシュされる）
    vi.advanceTimersByTime(2000)
    a.applyRemoteState('B', { cursor: 6, name: 'Bob' })

    // さらに 2秒後（最初の applyRemoteState から 4秒経過）
    // lastSeen がリフレッシュされたので B は生きている
    vi.advanceTimersByTime(2000)
    expect(a.getState('B')).toBeDefined()

    // さらに 2秒後（最後の applyRemoteState から 4秒経過）: タイムアウト
    vi.advanceTimersByTime(2000)
    expect(a.getState('B')).toBeUndefined()

    a.stopHeartbeat()
  })

  it('ローカルクライアント自身はタイムアウトしない', () => {
    const a = new Awareness<TestState>()
    a.setLocalState('A', { cursor: 0, name: 'Alice' })

    a.startHeartbeat(
      'A',
      () => ({ cursor: 0, name: 'Alice' }),
      () => {},
      { interval: 1000, timeout: 1000 },
    )

    // timeout を大幅に超えても A は削除されない
    vi.advanceTimersByTime(10_000)
    expect(a.getState('A')).toBeDefined()

    a.stopHeartbeat()
  })

  it('stopHeartbeat → startHeartbeat の再起動ができる', () => {
    const a = new Awareness<TestState>()
    const broadcast = vi.fn()

    a.startHeartbeat('A', () => ({ cursor: 0, name: 'Alice' }), broadcast, { interval: 1000 })
    vi.advanceTimersByTime(1000)
    a.stopHeartbeat()

    broadcast.mockClear()
    a.startHeartbeat('A', () => ({ cursor: 0, name: 'Alice' }), broadcast, { interval: 1000 })
    vi.advanceTimersByTime(1000)

    expect(broadcast).toHaveBeenCalledTimes(1)
    a.stopHeartbeat()
  })

  it('デフォルト定数が正しい値', () => {
    expect(HEARTBEAT_INTERVAL).toBe(30_000)
    expect(HEARTBEAT_TIMEOUT).toBe(60_000)
  })
})

describe('Awareness: Message 型との統合', () => {
  it('Awareness を Message として Provider に流す使い方', () => {
    // Message 型の確認（型チェックのみ）
    const a = new Awareness<TestState>()
    const sent: unknown[] = []

    a.setLocalState('A', { cursor: 0, name: 'Alice' })
    a.on('change', (states) => {
      // エディタ側がここで Provider に送信する想定
      for (const [clientId, state] of states) {
        sent.push({ type: 'awareness', clientId, data: state })
      }
    })

    a.setLocalState('A', { cursor: 3, name: 'Alice' })
    expect(sent.length).toBeGreaterThan(0)
    expect((sent[0] as { type: string }).type).toBe('awareness')
  })
})
