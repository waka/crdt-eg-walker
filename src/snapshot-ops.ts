/** snapshot 操作の抽象化（T[] と Rope を統一的に扱う） */
export interface SnapshotOps<T> {
  insert(pos: number, content: T): void
  delete(pos: number): void
}

/** T[] を SnapshotOps<T> としてラップする */
export function wrapArray<T>(arr: T[]): SnapshotOps<T> {
  return {
    insert(pos: number, content: T): void {
      arr.splice(pos, 0, content)
    },
    delete(pos: number): void {
      arr.splice(pos, 1)
    },
  }
}
