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

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

// Mulberry32, a small seeded PRNG. Returns a value in [0, 1) and the seed for
// the next call, so callers can stay pure.
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0
  let mixed  = Math.imul(next ^ (next >>> 15), next | 1)
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
  return { value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, seed: next }
}

export interface Interval {
  start: number
  end: number
}

// The parts of `base` not covered by any of `blocked`. Blocked intervals are
// open, so a free interval may touch one at its endpoint.
export function subtractIntervals(
  base: Interval,
  blocked: readonly Interval[],
): Interval[] {
  const free: Interval[] = []
  let cursor = base.start
  for (const interval of sortBy(blocked, (entry) => entry.start)) {
    if (interval.end <= cursor || interval.start >= base.end) {
      continue
    }
    else {
      if (interval.start >= cursor) {
        free.push({ start: cursor, end: interval.start })
      }
      cursor = interval.end
    }
  }
  if (cursor <= base.end) {
    free.push({ start: cursor, end: base.end })
  }
  return free
}

// The point `fraction` (0 to 1) of the way through the combined length of
// the intervals, or undefined when there are none.
export function pointInIntervals(
  intervals: readonly Interval[],
  fraction: number,
): number | undefined {
  const total = sum(intervals.map((interval) => interval.end - interval.start))
  let remaining = fraction * total
  for (const interval of intervals) {
    const length = interval.end - interval.start
    if (remaining <= length) {
      return interval.start + remaining
    }
    else {
      remaining -= length
    }
  }
  return intervals.length === 0 ? undefined : intervals[intervals.length - 1].end
}

// The item with the smallest key, or undefined for an empty list. Ties keep
// the earliest item.
export function minBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
  return maxBy(items, (item) => -key(item))
}

// Evenly spaced numbers from `start` to `end`, always including `end`.
// Empty when `end` is before `start`.
export function range(start: number, end: number, step: number): number[] {
  if (end < start) {
    return []
  }
  else {
    const count = Math.floor((end - start) / step)
    const steps = Array.from({ length: count + 1 }, (_, index) => start + index * step)
    return steps[steps.length - 1] === end ? steps : [...steps, end]
  }
}
