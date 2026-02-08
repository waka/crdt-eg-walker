import type { LVRange } from '../types.js'

/**
 * RLE圧縮されたLVRange配列に新しい範囲を追加する。
 * 直前のエントリと連続している場合はマージする。
 */
export function pushRLERange(ranges: LVRange[], start: number, end: number): void {
  if (ranges.length > 0) {
    const last = ranges[ranges.length - 1]!
    if (last[1] === start) {
      // 直前のエントリと連続しているのでマージ
      last[1] = end
      return
    }
  }
  ranges.push([start, end])
}

/**
 * RLE圧縮されたLVRange配列から、指定されたLVを含む範囲のインデックスを返す。
 * 見つからない場合は-1を返す。
 */
export function findInRLERanges(ranges: readonly LVRange[], lv: number): number {
  let low = 0
  let high = ranges.length - 1

  while (low <= high) {
    const mid = (low + high) >>> 1
    const range = ranges[mid]!
    if (lv < range[0]) {
      high = mid - 1
    } else if (lv >= range[1]) {
      low = mid + 1
    } else {
      return mid
    }
  }

  return -1
}
