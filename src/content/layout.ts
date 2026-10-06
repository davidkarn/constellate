import {
  minBy,
  nextRandom,
  pointInIntervals,
  range,
  sortBy,
  subtractIntervals,
  sum,
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
  // Space between the bubbles of a reply chain.
  replyGap: number
  // How far replies in a chain are indented from the chain's first message.
  indent: number
  // How far below the previous message's top the search for a spot starts.
  drop: number
  // How far below every other message's top a new message must start.
  minDrop: number
  // How far the search moves down each time a row has no room.
  step: number
  // How far a bubble may be pushed sideways to make room.
  push: number
  // How far a bubble may be pushed up to make room for a reply chain.
  lift: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedBubble extends Rect {
  id: string
  // The message this one replies to.
  parentId: string | null
  // The width the bubble's content needs. Bubbles in a reply chain are
  // stretched wider so the chain's right edges line up.
  naturalWidth: number
  // The first message of the reply chain this bubble is stacked under, or
  // null when it isn't an indented reply.
  anchorId: string | null
}

export interface ChatLayout {
  // In placement order; the last one is the most recently placed.
  bubbles: PlacedBubble[]
  // Seed for the next random choice.
  seed: number
}

export interface NewBubble {
  id: string
  parentId: string | null
  width: number
  height: number
}

// A line from under a chain's first message, down and then right into one
// of its indented replies.
export interface Connector {
  id: string
  left: number
  top: number
  width: number
  height: number
}

// A bubble's content size, before it's positioned in a reply chain.
interface StackItem {
  id: string
  parentId: string | null
  naturalWidth: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

interface Spot {
  // The existing bubbles, some possibly pushed aside to make room.
  bubbles: PlacedBubble[]
  point: Point
}

interface Move {
  bubble: PlacedBubble
  distance: number
}

// Tolerance for floating point error when comparing distances.
const EPSILON = 1e-6

export function emptyLayout(seed: number): ChatLayout {
  return { bubbles: [], seed }
}

function bottomOf(rect: Rect): number {
  return rect.y + rect.height
}

// Whether two rectangles are closer than `gap` on both axes.
function tooClose(a: Rect, b: Rect, gap: number): boolean {
  const apartX =
    a.x + a.width + gap <= b.x + EPSILON || b.x + b.width + gap <= a.x + EPSILON
  const apartY =
    bottomOf(a) + gap <= b.y + EPSILON || bottomOf(b) + gap <= a.y + EPSILON
  return !apartX && !apartY
}

// Whether `rect` comes within `gap` of the horizontal band from `top` to
// `bottom`.
function overlapsBand(rect: Rect, top: number, bottom: number, gap: number): boolean {
  return rect.y < bottom + gap && bottomOf(rect) > top - gap
}

function rowBubbles(
  bubbles: readonly PlacedBubble[],
  y: number,
  height: number,
  options: LayoutOptions,
): PlacedBubble[] {
  return bubbles.filter((bubble) => overlapsBand(bubble, y, y + height, options.gap))
}

// The left edges where a rectangle of this size fits at `y`, staying inside
// the margins and `gap` away from every bubble.
function freeLefts(
  bubbles: readonly PlacedBubble[],
  y: number,
  size: Size,
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

// The highest top a new message of this height can have while being the
// lowest message and starting `minDrop` below every other message's top.
function minimumTop(
  bubbles: readonly PlacedBubble[],
  height: number,
  options: LayoutOptions,
): number {
  return Math.max(
    ...bubbles.map((bubble) =>
      Math.max(bubble.y + options.minDrop, bottomOf(bubble) - height),
    ),
  )
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

// Starting `drop` below the previous message's top (and low enough to be the
// lowest message), finds the first row with room for a bubble of this size
// and picks a random spot in it. A row that's too crowded gets its bubbles
// pushed sideways first; if that still doesn't make room, the pushes are
// dropped and the search moves down `step`. Rows below every existing bubble
// are always free, so the search ends.
function findSpot(
  bubbles: readonly PlacedBubble[],
  previous: PlacedBubble,
  size: Size,
  fraction: number,
  options: LayoutOptions,
): Spot {
  let y = Math.max(previous.y + options.drop, minimumTop(bubbles, size.height, options))
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

// The chain of messages that `parentId` ends, oldest first.
function replyChain(bubbles: readonly PlacedBubble[], parentId: string): PlacedBubble[] {
  const byId    = new Map(bubbles.map((bubble) => [bubble.id, bubble]))
  const chain: PlacedBubble[] = []
  let current   = byId.get(parentId)
  while (current !== undefined && !chain.includes(current)) {
    chain.unshift(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return chain
}

function toStackItem(bubble: PlacedBubble): StackItem {
  return {
    id: bubble.id,
    parentId: bubble.parentId,
    naturalWidth: bubble.naturalWidth,
    height: bubble.height,
  }
}

// The width of a reply chain: wide enough for the first message, and for
// each reply after its indent.
function stackWidth(items: readonly StackItem[], options: LayoutOptions): number {
  const widths = items.map((item, index) => {
    if (index === 0) {
      return item.naturalWidth
    }
    else {
      return item.naturalWidth + options.indent
    }
  })
  return Math.min(Math.max(...widths), options.width - 2 * options.margin)
}

function stackHeight(items: readonly StackItem[], options: LayoutOptions): number {
  return sum(items.map((item) => item.height)) + options.replyGap * (items.length - 1)
}

// Stacks a reply chain top to bottom from (`x`, `top`), `replyGap` apart. The
// replies are indented under the first message, and every bubble reaches
// the chain's right edge.
function stackBubbles(
  items: readonly StackItem[],
  x: number,
  top: number,
  options: LayoutOptions,
): PlacedBubble[] {
  const width = stackWidth(items, options)
  const root  = items[0]
  return items.reduce<PlacedBubble[]>((stacked, item) => {
    const above  = stacked[stacked.length - 1]
    const y      = above === undefined ? top : bottomOf(above) + options.replyGap
    const indent = above === undefined ? 0 : options.indent
    const anchor = above === undefined ? null : root.id
    return [
      ...stacked,
      { ...item, x: x + indent, y, width: width - indent, anchorId: anchor },
    ]
  }, [])
}

// Unhooks bubbles that were stacked under any of `ids`, which have just been
// moved into a new chain.
function detachFrom(bubbles: readonly PlacedBubble[], ids: Set<string>): PlacedBubble[] {
  return bubbles.map((bubble) => {
    if (bubble.anchorId !== null && ids.has(bubble.anchorId)) {
      return { ...bubble, anchorId: null }
    }
    else {
      return bubble
    }
  })
}

// The shortest way to move `bubble` clear of `rect`: up by at most `lift`, or
// sideways by at most `push` without leaving the margins.
function escape(
  bubble: PlacedBubble,
  rect: Rect,
  options: LayoutOptions,
): Move | undefined {
  const up    = bottomOf(bubble) + options.gap - rect.y
  const left  = bubble.x + bubble.width + options.gap - rect.x
  const right = rect.x + rect.width + options.gap - bubble.x
  const moves = [
    {
      bubble: { ...bubble, y: bubble.y - up },
      distance: up,
      allowed: up <= options.lift,
    },
    {
      bubble: { ...bubble, x: bubble.x - left },
      distance: left,
      allowed: left <= options.push && bubble.x - left >= options.margin - EPSILON,
    },
    {
      bubble: { ...bubble, x: bubble.x + right },
      distance: right,
      allowed:
        right <= options.push &&
        bubble.x + right + bubble.width <= options.width - options.margin + EPSILON,
    },
  ]
  return minBy(moves.filter((move) => move.allowed), (move) => move.distance)
}

// Moves every bubble that's too close to `rect` out of its way. Undefined
// when a bubble can't get clear, or a moved bubble ends up too close to
// another.
function clearRect(
  bubbles: readonly PlacedBubble[],
  rect: Rect,
  options: LayoutOptions,
): { bubbles: PlacedBubble[]; cost: number } | undefined {
  const moves = bubbles.map((bubble) => {
    if (tooClose(bubble, rect, options.gap)) {
      return escape(bubble, rect, options)
    }
    else {
      return { bubble, distance: 0 }
    }
  })

  if (moves.some((move) => move === undefined)) {
    return undefined
  }
  else {
    const settled = moves as Move[]
    const moved   = settled.map((move) => move.bubble)
    const clashes = settled.some(
      (move) =>
        move.distance > 0 &&
        moved.some((other) => other.id !== move.bubble.id &&
          tooClose(move.bubble, other, options.gap)),
    )
    if (clashes) {
      return undefined
    }
    else {
      return { bubbles: moved, cost: sum(settled.map((move) => move.distance)) }
    }
  }
}

// The left edge at `y` where pushing bubbles aside makes room for a
// rectangle of this size with the least total movement. Ties are broken by
// `fraction`.
function cheapestPush(
  bubbles: readonly PlacedBubble[],
  y: number,
  size: Size,
  fraction: number,
  options: LayoutOptions,
): Spot | undefined {
  const maxLeft    = options.width - options.margin - size.width
  const candidates = range(options.margin, maxLeft, options.step / 2).flatMap((x) => {
    const cleared = clearRect(bubbles, { x, y, ...size }, options)
    return cleared === undefined ? [] : [{ x, ...cleared }]
  })
  const cheapest = minBy(candidates, (candidate) => candidate.cost)
  if (cheapest === undefined) {
    return undefined
  }
  else {
    const tied   = candidates.filter((candidate) => candidate.cost - cheapest.cost < 0.5)
    const chosen = tied[Math.min(tied.length - 1, Math.floor(fraction * tied.length))]
    return { bubbles: chosen.bubbles, point: { x: chosen.x, y } }
  }
}

// Stacks a reply chain, ending with the new reply, as high as it can go
// while the reply is the lowest message and starts `minDrop` below every
// other message's top. Bubbles in the way are pushed up or sideways; if that
// can't make room, the search moves down `step`.
function findChainSpot(
  others: readonly PlacedBubble[],
  chain: readonly StackItem[],
  fraction: number,
  options: LayoutOptions,
): Spot {
  const reply = chain[chain.length - 1]
  const size  = { width: stackWidth(chain, options), height: stackHeight(chain, options) }
  let y = minimumTop(others, reply.height, options) - (size.height - reply.height)
  while (true) {
    const x = pointInIntervals(freeLefts(others, y, size, options), fraction)
    if (x !== undefined) {
      return { bubbles: [...others], point: { x, y } }
    }
    else {
      const pushed = cheapestPush(others, y, size, fraction, options)
      if (pushed !== undefined) {
        return pushed
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

function placeBubbles(
  bubbles: readonly PlacedBubble[],
  bubble: NewBubble,
  fraction: number,
  options: LayoutOptions,
): PlacedBubble[] {
  const chain = bubble.parentId === null ? [] : replyChain(bubbles, bubble.parentId)
  const chainIds = new Set(chain.map((entry) => entry.id))
  const unmoved  = bubbles.filter((entry) => !chainIds.has(entry.id))
  const others   = detachFrom(unmoved, chainIds)
  const previous = bubbles[bubbles.length - 1]
  const item     = { ...bubble, naturalWidth: bubble.width }
  const stacked  = [...chain.map(toStackItem), item]

  if (others.length === 0) {
    const spot = randomSpot(stackWidth(stacked, options), fraction, options)
    return stackBubbles(stacked, spot.x, spot.y, options)
  }
  else if (chain.length === 0) {
    const spot = findSpot(bubbles, previous, bubble, fraction, options)
    return [...spot.bubbles, { ...item, ...spot.point, anchorId: null }]
  }
  else {
    const spot     = findChainSpot(others, stacked, fraction, options)
    const { x, y } = spot.point
    return [...spot.bubbles, ...stackBubbles(stacked, x, y, options)]
  }
}

// Moves every bubble vertically so the lowest bottom edge sits `margin`
// above the panel's bottom, and drops bubbles that end up entirely above
// the top.
function alignToBottom(bubbles: readonly PlacedBubble[], options: LayoutOptions) {
  const lowest = Math.max(...bubbles.map(bottomOf))
  const shift  = options.height - options.margin - lowest
  return bubbles
    .map((bubble) => ({ ...bubble, y: bubble.y + shift }))
    .filter((bubble) => bottomOf(bubble) > 0)
}

// Places a new message, then moves everything so it sits at the bottom of
// the panel. It's always the lowest message, and starts at least `minDrop`
// below every other message's top.
//
// - The first message goes at a random spot.
// - A reply is stacked under the chain of messages it replies to, which is
//   moved down beside it. The chain goes as high as it can, pushing other
//   bubbles up to `lift` up or `push` sideways to make room.
// - Any other message goes in a random free spot starting `drop` below the
//   previous message, pushing a crowded row's bubbles up to `push` sideways
//   to make room.
export function placeMessage(
  layout: ChatLayout,
  bubble: NewBubble,
  options: LayoutOptions,
): ChatLayout {
  const random = nextRandom(layout.seed)
  const width  = Math.min(bubble.width, options.width - 2 * options.margin)
  const placed = placeBubbles(layout.bubbles, { ...bubble, width }, random.value, options)
  return { bubbles: alignToBottom(placed, options), seed: random.seed }
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

// The lines joining each indented reply to the first message of its chain:
// down from `spine` px in from the first message's left edge, then right into
// the reply `elbow` px below its top. Bubbles pushed out of line since they
// were stacked get no line.
export function connectors(
  layout: ChatLayout,
  spine: number,
  elbow: number,
): Connector[] {
  const byId = new Map(layout.bubbles.map((bubble) => [bubble.id, bubble]))
  return layout.bubbles.flatMap((bubble) => {
    const root = bubble.anchorId === null ? undefined : byId.get(bubble.anchorId)
    if (root === undefined) {
      return []
    }
    else {
      const left   = root.x + spine
      const top    = bottomOf(root)
      const bottom = bubble.y + elbow
      if (bubble.x <= left || bottom <= top) {
        return []
      }
      else {
        const width  = bubble.x - left
        const height = bottom - top
        return [{ id: bubble.id, left, top, width, height }]
      }
    }
  })
}
