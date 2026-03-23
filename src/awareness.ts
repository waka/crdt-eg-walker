/**
 * Awareness
 *
 * 協調編集で「CRDTで同期する必要はないが、今すぐ他ユーザーに伝えたい状態」を共有する。
 * 典型例: カーソル位置・選択範囲・ユーザー名・オンライン状態
 *
 * CRDTとの違い:
 *   - 永続化不要（揮発性）
 *   - 収束保証不要
 *   - Last-Write-Wins で十分
 *   - 因果関係不要
 *
 * 接続が切れたら消えていい情報のため、最後に届いた値が正。
 * 一定時間応答がなければ自動でオフライン扱いにする（ハートビート）。
 */

// ===== 定数 =====

/** ハートビートの送信間隔（ミリ秒） */
export const HEARTBEAT_INTERVAL = 30_000

/** この時間応答がなければオフライン扱い（ミリ秒） */
export const HEARTBEAT_TIMEOUT = 60_000

// ===== 型定義 =====

/** Awareness エントリ（内部型） */
interface AwarenessEntry<T> {
  state: T
  /** 最後に受信した時刻（ハートビート判定用） */
  lastSeen: number
}

/** ハートビートのオプション */
export interface AwarenessOptions {
  /** ハートビート送信間隔（ms）。省略時は HEARTBEAT_INTERVAL */
  interval?: number
  /** この時間応答なければ削除（ms）。省略時は HEARTBEAT_TIMEOUT */
  timeout?: number
}

/**
 * Provider に流すメッセージの型。
 * CRDT の op と Awareness を同一チャンネルで区別して扱う。
 *
 * @template T  Awareness の状態型
 */
export type Message<T = unknown> =
  | { type: 'op'; data: Uint8Array }
  | { type: 'awareness'; clientId: string; data: T }

// ===== Awareness クラス =====

/**
 * 協調編集の Awareness（リアルタイム共有状態）管理クラス。
 *
 * @template T  共有する状態の型（エディタ側が自由に定義）
 *
 * @example
 * ```typescript
 * type EditorAwareness = {
 *   cursor: { anchor: Anchor; head: Anchor }
 *   user: { name: string; color: string }
 * }
 *
 * const awareness = new Awareness<EditorAwareness>()
 *
 * // カーソルが動いたとき
 * awareness.setLocalState(myClientId, {
 *   cursor: { anchor: indexToAnchor(ctx, start), head: indexToAnchor(ctx, end) },
 *   user: { name: 'waka', color: '#E8F4F8' },
 * })
 *
 * // 他クライアントの状態変化を受信
 * awareness.on('change', (states) => renderRemoteCursors(states))
 *
 * // リモートから受け取ったとき
 * awareness.applyRemoteState(remoteClientId, remoteState)
 * ```
 */
export class Awareness<T> {
  private _store: Map<string, AwarenessEntry<T>> = new Map()
  private _handlers: Set<(states: Map<string, T>) => void> = new Set()
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // ===== 状態管理 =====

  /**
   * ローカルクライアントの状態を設定して即座に change イベントを発火する。
   * Provider 経由で他クライアントへブロードキャストするのは呼び出し元の責務。
   */
  setLocalState(clientId: string, state: T): void {
    this._store.set(clientId, { state, lastSeen: Date.now() })
    this._emit()
  }

  /**
   * リモートクライアントの状態を受信・反映する。
   * ハートビートの lastSeen も更新するため、setLocalState ではなく
   * このメソッドをリモート受信時に使う。
   */
  applyRemoteState(clientId: string, state: T): void {
    this._store.set(clientId, { state, lastSeen: Date.now() })
    this._emit()
  }

  /**
   * 指定クライアントの状態を削除して change イベントを発火する。
   * ハートビートタイムアウト時や切断時に呼ぶ。
   */
  removeState(clientId: string): void {
    if (!this._store.has(clientId)) return
    this._store.delete(clientId)
    this._emit()
  }

  /**
   * 現在の全クライアント状態を返す（スナップショット）。
   * Map のコピーを返すため、呼び出し後の変更は反映されない。
   */
  getStates(): Map<string, T> {
    const result = new Map<string, T>()
    for (const [clientId, entry] of this._store) {
      result.set(clientId, entry.state)
    }
    return result
  }

  /**
   * 指定クライアントの状態を返す。存在しない場合は undefined。
   */
  getState(clientId: string): T | undefined {
    return this._store.get(clientId)?.state
  }

  // ===== イベント =====

  /**
   * 状態変化を購読する。
   * @param event  現在は 'change' のみ
   * @param handler  全クライアントの現在状態 Map を受け取る関数
   */
  on(event: 'change', handler: (states: Map<string, T>) => void): void {
    this._handlers.add(handler)
  }

  /**
   * 購読を解除する。
   */
  off(event: 'change', handler: (states: Map<string, T>) => void): void {
    this._handlers.delete(handler)
  }

  // ===== ハートビート =====

  /**
   * ハートビートを開始する。
   *
   * 一定間隔で:
   *   1. `broadcast(getState())` を呼んでローカル状態を送信する
   *   2. 一定時間応答がないリモートクライアントを削除する
   *
   * @param localClientId  ローカルクライアントの ID（タイムアウト除外対象）
   * @param getState       現在のローカル状態を返す関数
   * @param broadcast      他クライアントへ状態を送信する関数
   * @param opts           interval / timeout のオプション
   */
  startHeartbeat(
    localClientId: string,
    getState: () => T,
    broadcast: (state: T) => void,
    opts: AwarenessOptions = {},
  ): void {
    this.stopHeartbeat()  // 既存のタイマーをクリーンアップ

    const interval = opts.interval ?? HEARTBEAT_INTERVAL
    const timeout = opts.timeout ?? HEARTBEAT_TIMEOUT

    this._heartbeatTimer = setInterval(() => {
      // ローカル状態を送信
      broadcast(getState())

      // タイムアウトしたリモートクライアントを削除
      const now = Date.now()
      let changed = false
      for (const [clientId, entry] of this._store) {
        if (clientId === localClientId) continue
        if (now - entry.lastSeen > timeout) {
          this._store.delete(clientId)
          changed = true
        }
      }
      if (changed) this._emit()
    }, interval)
  }

  /**
   * ハートビートを停止する。
   * Awareness を破棄する前や接続切断時に呼ぶ。
   */
  stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  // ===== 内部 =====

  private _emit(): void {
    if (this._handlers.size === 0) return
    const states = this.getStates()
    for (const handler of this._handlers) {
      handler(states)
    }
  }
}
