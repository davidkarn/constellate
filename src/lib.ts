// Keeps the first item seen for each key, preserving input order.
export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>()
  return items.filter((item) => {
    const itemKey = key(item)
    if (seen.has(itemKey)) {
      return false
    }
    else {
      seen.add(itemKey)
      return true
    }
  })
}

// Stable ascending sort by a numeric key. Does not mutate the input.
export function sortBy<T>(items: readonly T[], key: (item: T) => number): T[] {
  return [...items].sort((a, b) => key(a) - key(b))
}

// The item with the largest key, or undefined for an empty list. Ties keep the
// earliest item.
export function maxBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => {
    if (best === undefined || key(item) > key(best)) {
      return item
    }
    else {
      return best
    }
  }, undefined)
}

export interface TaskQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

// Runs async tasks one at a time, in the order they were queued. A failed task
// rejects its own promise without stopping later tasks.
export function createTaskQueue(): TaskQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task)
      tail = result.catch(() => {})
      return result
    },
  }
}

// Groups items by key. Groups keep the order their first item was seen in,
// and items keep their input order within each group.
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const itemKey = key(item)
    const group   = groups.get(itemKey)
    if (group === undefined) {
      groups.set(itemKey, [item])
    }
    else {
      group.push(item)
    }
  }
  return groups
}
