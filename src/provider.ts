/**
 * Provider
 *
 * ネットワーク・永続化層を差し替え可能にする薄い抽象。
 * 最初は WebSocketProvider のみ実装。
 * テスト用に InMemoryProvider に差し替えられる余地を残す。
 */

// ===== Provider インターフェース =====

/** Provider が発火するイベントの型定義 */
export interface ProviderEventMap {
  op: (data: Uint8Array) => void
  connect: () => void
  disconnect: () => void
}

/** ネットワーク・永続化の抽象インターフェース */
export interface Provider {
  connect(): void
  disconnect(): void
  /** エンコード済みの op バイト列を送信する */
  sendOp(data: Uint8Array): void
  on<K extends keyof ProviderEventMap>(event: K, handler: ProviderEventMap[K]): void
  off<K extends keyof ProviderEventMap>(event: K, handler: ProviderEventMap[K]): void
}

// ===== ProviderBase（共通イベントバス） =====

/** イベントバスの共通実装。Provider 実装のベースクラス。 */
export abstract class ProviderBase implements Provider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handlers: Map<string, Set<(...args: any[]) => void>> = new Map()

  abstract connect(): void
  abstract disconnect(): void
  abstract sendOp(data: Uint8Array): void

  on<K extends keyof ProviderEventMap>(event: K, handler: ProviderEventMap[K]): void {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set())
    this._handlers.get(event)!.add(handler)
  }

  off<K extends keyof ProviderEventMap>(event: K, handler: ProviderEventMap[K]): void {
    this._handlers.get(event)?.delete(handler)
  }

  protected emit<K extends keyof ProviderEventMap>(
    event: K,
    ...args: Parameters<ProviderEventMap[K]>
  ): void {
    this._handlers.get(event)?.forEach((h) => h(...args))
  }
}

// ===== WebSocketProvider =====

/** WebSocket を使ったリアルタイム同期 Provider */
export class WebSocketProvider extends ProviderBase {
  private _ws: WebSocket | null = null

  constructor(private readonly _url: string) {
    super()
  }

  connect(): void {
    this._ws = new WebSocket(this._url)
    this._ws.binaryType = 'arraybuffer'

    this._ws.onopen = () => this.emit('connect')
    this._ws.onclose = () => this.emit('disconnect')
    this._ws.onmessage = (e: MessageEvent) => {
      this.emit('op', new Uint8Array(e.data as ArrayBuffer))
    }
  }

  disconnect(): void {
    this._ws?.close()
    this._ws = null
  }

  sendOp(data: Uint8Array): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(data as Uint8Array<ArrayBuffer>)
    }
  }
}

// ===== InMemoryProvider =====

/**
 * テスト・インメモリ複数クライアントシミュレーション用 Provider。
 * ピアを接続して op を双方向に転送する。
 */
export class InMemoryProvider extends ProviderBase {
  private _peers: Set<InMemoryProvider> = new Set()
  private _connected = false

  connect(): void {
    this._connected = true
    this.emit('connect')
  }

  disconnect(): void {
    this._connected = false
    this.emit('disconnect')
  }

  sendOp(data: Uint8Array): void {
    if (!this._connected) return
    // 接続済みの全ピアに転送する
    for (const peer of this._peers) {
      if (peer._connected) {
        peer.emit('op', data)
      }
    }
  }

  /** ピアを双方向に接続する */
  connectPeer(peer: InMemoryProvider): void {
    this._peers.add(peer)
    peer._peers.add(this)
  }

  /** ピアとの接続を解除する */
  disconnectPeer(peer: InMemoryProvider): void {
    this._peers.delete(peer)
    peer._peers.delete(this)
  }
}
