/**
 * エンコーディング
 *
 * ListOpLog・Message の MessagePack シリアライズ / デシリアライズ。
 * ネットワーク同期・永続化の両方でこのフォーマットを統一して使う。
 */

import { encode, decode } from '@msgpack/msgpack'
import type { ListOpLog } from './types.js'
import type { Message } from './awareness.js'

/**
 * ListOpLog を MessagePack バイト列に変換する。
 * ネットワーク送信・永続化に使用。
 */
export const encodeOpLog = <T = string>(opLog: ListOpLog<T>): Uint8Array =>
  encode(opLog)

/**
 * MessagePack バイト列を ListOpLog に復元する。
 */
export const decodeOpLog = <T = string>(data: Uint8Array): ListOpLog<T> =>
  decode(data) as ListOpLog<T>

/**
 * Message を MessagePack バイト列に変換する。
 * op と awareness を同一チャンネルで流すためのフレーミング。
 *
 * Provider.sendOp に渡す Uint8Array として使う。
 *
 * @example
 * ```typescript
 * // CRDT op を送信
 * provider.sendOp(encodeMessage({ type: 'op', data: encodeOpLog(oplog) }))
 *
 * // Awareness を送信
 * provider.sendOp(encodeMessage({ type: 'awareness', clientId: myId, data: state }))
 * ```
 */
export const encodeMessage = <T = unknown>(msg: Message<T>): Uint8Array =>
  encode(msg)

/**
 * MessagePack バイト列を Message に復元する。
 */
export const decodeMessage = <T = unknown>(data: Uint8Array): Message<T> =>
  decode(data) as Message<T>
