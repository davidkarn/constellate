import {
  nextRandom,
  pointInIntervals,
  sortBy,
  subtractIntervals,
  type Interval,
} from '../lib'

// Distances are in pixels, measured from the panel's top-left corner.
export interface LayoutOptions {
  // Panel size.
  width: number
  height: number
  // Space kept clear along the panel's edges.
  margin: number
  // Minimum space between bubbles.
  gap: number
  // How far below the previous message's top the search for a spot starts.
  drop: number
  // How far the search moves down each time a row has no room.
  step: number
  // How far a bubble on a crowded row may be pushed sideways to make room.
  push: number
}

export interface PlacedBubble {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface ChatLayout {
  // Oldest first; the last one is the most recently placed.
  bubbles: PlacedBubble[]
  // Seed for the next random choice.
  seed: number
}

export interface NewBubble {
  id: string
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface Spot {
  // The existing bubbles, some possibly pushed sideways to make room.
  bubbles: PlacedBubble[]
  point: Point
}

export function emptyLayout(seed: number): ChatLayout {
  return { bubbles: [], seed }
}

// Whether `bubble` comes within `gap` of the horizontal band from `top` to
// `bottom`.
function overlapsBand(
  bubble: PlacedBubble,
  top: number,
  bottom: number,
  gap: number,
): boolean {
  return bubble.y < bottom + gap && bubble.y + bubble.height > top - gap
}

// Starting `drop` below the previous message's top, finds the first row with
// room for a bubble of this size, moving down `step` at a time, and picks a
// random spot in that row. Rows below every existing bubble are always free,
// so the search ends.
function rowBubbles(
  bubbles: readonly PlacedBubble[],
  y: number,
  height: number,
  options: LayoutOptions,
): PlacedBubble[] {
  return bubbles.filter((bubble) => overlapsBand(bubble, y, y + height, options.gap))
}

// The left edges where a bubble of this size fits at `y`, staying inside the
// margins and `gap` away from every other bubble.
function freeLefts(
  bubbles: readonly PlacedBubble[],
  y: number,
  size: { width: number; height: number },
  options: LayoutOptions,
): Interval[] {
  const lefts   = {
    start: options.margin,
    end: options.width - options.margin - size.width,
  }
  const blocked = rowBubbles(bubbles, y, size.height, options).map((bubble) => ({
    start: bubble.x - options.gap - size.width,
    end: bubble.x + bubble.width + options.gap,
  }))
  return subtractIntervals(lefts, blocked)
}

// How far `bubble` can move left (-1) or right (1) before leaving the
// margins or coming within `gap` of another bubble.
function room(
  bubble: PlacedBubble,
  direction: -1 | 1,
  bubbles: readonly PlacedBubble[],
  options: LayoutOptions,
): number {
  const right = bubble.x + bubble.width
  const neighbours = rowBubbles(bubbles, bubble.y, bubble.height, options)
    .filter((other) => other.id !== bubble.id)
  if (direction === -1) {
    const limits = neighbours
      .filter((other) => other.x + other.width <= bubble.x)
      .map((other) => bubble.x - (other.x + other.width) - options.gap)
    return Math.max(0, Math.min(bubble.x - options.margin, ...limits))
  }
  else {
    const limits = neighbours
      .filter((other) => other.x >= right)
      .map((other) => other.x - right - options.gap)
    return Math.max(0, Math.min(options.width - options.margin - right, ...limits))
  }
}

// Pushes each of `row`'s bubbles, left to right, up to `push` towards
// whichever side has less room, which widens the gap on its other side.
// Each push accounts for the ones before it.
function pushRow(
  bubbles: readonly PlacedBubble[],
  row: readonly PlacedBubble[],
  options: LayoutOptions,
): PlacedBubble[] {
  return sortBy(row, (bubble) => bubble.x).reduce((current, { id }) => {
    const bubble = current.find((entry) => entry.id === id)
    if (bubble === undefined) {
      return current
    }
    else {
      const left  = room(bubble, -1, current, options)
      const right = room(bubble, 1, current, options)
      const shift =
        left <= right ? -Math.min(options.push, left) : Math.min(options.push, right)
      return current.map((entry) => {
        if (entry.id === id) {
          return { ...entry, x: entry.x + shift }
        }
        else {
          return entry
        }
      })
    }
  }, [...bubbles])
}

// Starting `drop` below the previous message's top, finds the first row with
// room for a bubble of this size and picks a random spot in it. A row that's
// too crowded gets its bubbles pushed sideways first; if that still doesn't
// make room, the pushes are dropped and the search moves down `step`. Rows
// below every existing bubble are always free, so the search ends.
function findSpot(
  bubbles: readonly PlacedBubble[],
  previous: PlacedBubble,
  size: { width: number; height: number },
  fraction: number,
  options: LayoutOptions,
): Spot {
  let y = previous.y + options.drop
  while (true) {
    const x = pointInIntervals(freeLefts(bubbles, y, size, options), fraction)
    if (x !== undefined) {
      return { bubbles: [...bubbles], point: { x, y } }
    }
    else {
      const row     = rowBubbles(bubbles, y, size.height, options)
      const pushed  = pushRow(bubbles, row, options)
      const pushedX = pointInIntervals(freeLefts(pushed, y, size, options), fraction)
      if (pushedX !== undefined) {
        return { bubbles: pushed, point: { x: pushedX, y } }
      }
      else {
        y += options.step
      }
    }
  }
}

function randomSpot(width: number, fraction: number, options: LayoutOptions): Point {
  const room = options.width - 2 * options.margin - width
  return { x: options.margin + fraction * room, y: 0 }
}

// Moves every bubble vertically so the newest one's bottom edge sits
// `margin` above the panel's bottom, and drops bubbles that end up entirely
// above the top.
function alignToBottom(bubbles: readonly PlacedBubble[], options: LayoutOptions) {
  const newest = bubbles[bubbles.length - 1]
  const shift  = options.height - options.margin - (newest.y + newest.height)
  return bubbles
    .map((bubble) => ({ ...bubble, y: bubble.y + shift }))
    .filter((bubble) => bubble.y + bubble.height > 0)
}

// Places a new message: the first at a random spot, each later one in a
// random free spot starting `drop` below the previous message, pushing
// crowded rows' bubbles aside when that makes room. Then moves everything so
// the new message sits at the bottom of the panel.
export function placeMessage(
  layout: ChatLayout,
  bubble: NewBubble,
  options: LayoutOptions,
): ChatLayout {
  const random   = nextRandom(layout.seed)
  const width    = Math.min(bubble.width, options.width - 2 * options.margin)
  const size     = { width, height: bubble.height }
  const previous = layout.bubbles[layout.bubbles.length - 1]

  const spot =
    previous === undefined
      ? { bubbles: [], point: randomSpot(width, random.value, options) }
      : findSpot(layout.bubbles, previous, size, random.value, options)
  const placed = { id: bubble.id, ...spot.point, ...size }

  return {
    bubbles: alignToBottom([...spot.bubbles, placed], options),
    seed: random.seed,
  }
}

// Lays out messages from scratch, oldest first.
export function layoutMessages(
  bubbles: readonly NewBubble[],
  options: LayoutOptions,
  seed: number,
): ChatLayout {
  return bubbles.reduce(
    (layout, bubble) => placeMessage(layout, bubble, options),
    emptyLayout(seed),
  )
}
