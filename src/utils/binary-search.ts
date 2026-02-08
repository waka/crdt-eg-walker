/**
 * 二分探索
 * ソート済み配列から、比較関数が0を返す要素のインデックスを返す。
 * 見つからない場合は挿入位置を負数（-(挿入位置) - 1）で返す。
 */
export function binarySearch<T>(
  arr: readonly T[],
  compare: (item: T) => number,
): number {
  let low = 0
  let high = arr.length - 1

  while (low <= high) {
    const mid = (low + high) >>> 1
    const cmp = compare(arr[mid]!)
    if (cmp > 0) {
      low = mid + 1
    } else if (cmp < 0) {
      high = mid - 1
    } else {
      return mid
    }
  }

  return -low - 1
}
