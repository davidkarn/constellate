import type { ChatMessage } from '../shared/chat'
import {
  COMPOSER_STYLE,
  createComposer,
  type Composer,
  type SendMessage,
} from './composer'
import { createButton, createElement } from './dom'
import { authorInitial, avatarColor, formatVideoTime } from './format'
import {
  connectors,
  emptyLayout,
  layoutMessages,
  placeMessage,
  viewport,
  type ChatLayout,
  type LayoutOptions,
  type NewBubble,
} from './layout'

// Bubbles shrink to fit their text, up to this fraction of the panel width.
const MAX_BUBBLE_WIDTH = 0.3
// Recent messages kept so the panel can be laid out again after a resize.
// Messages kept for scrolling back through, and for laying out again after a
// resize. Older ones are dropped.
const MAX_MESSAGES = 300
// How close to the bottom counts as following the newest messages.
const BOTTOM_THRESHOLD = 8
// How long after a wheel, touch or key event scrolling counts as the
// viewer's own.
const USER_SCROLL_MS = 500
const RESIZE_DEBOUNCE_MS = 150

// Reply chain geometry, in px, matched to the chat design.
const REPLY_GAP = 8
const REPLY_INDENT = 44
// Where the connector line leaves the chain's first message, from its left
// edge, and where it enters a reply, from its top.
const CONNECTOR_SPINE = 16
const CONNECTOR_ELBOW = 20

// Gives the video column the left half of the window. The panel covers the
// right half, including YouTube's #secondary column.
const PAGE_STYLE = `
ytd-watch-flexy #columns {
  max-width: none !important;
  margin: 0 !important;
}
ytd-watch-flexy #primary {
  max-width: none !important;
  min-width: 0 !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
ytd-watch-flexy #primary-inner {
  width: 50vw !important;
  max-width: 50vw !important;
}
`

// Indented replies get their own colors and a smaller avatar. Both kinds
// share the same vertical sizes, so a bubble's height doesn't change when it
// becomes part of a reply chain.
const PANEL_STYLE = `
:host {
  all: initial;
}
.frame {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgb(15, 15, 15);
  color: rgb(212, 214, 219);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
.stage-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}
.stage {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-color: rgb(51, 57, 81) transparent;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}
.canvas {
  position: relative;
}
.jump-button {
  position: absolute;
  bottom: 12px;
  left: 50%;
  padding: 6px 14px;
  border: 1px solid rgb(51, 57, 81);
  border-radius: 16px;
  background: rgb(26, 29, 37);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: rgb(233, 234, 237);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transform: translateX(-50%);
}
.jump-button[hidden] {
  display: none;
}
.bubble {
  position: absolute;
  box-sizing: border-box;
  padding: 16px 18px 18px;
  border: 1px solid rgb(34, 37, 43);
  border-radius: 12px;
  background: rgb(25, 27, 31);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  overflow-wrap: anywhere;
  transition: top 300ms ease, left 300ms ease, width 300ms ease;
}
.bubble.reply {
  border-color: rgb(51, 57, 81);
  background: rgb(26, 29, 37);
}
.bubble.measuring {
  visibility: hidden;
  transition: none;
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 20px;
  margin-bottom: 8px;
}
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: rgb(17, 19, 21);
  font-size: 10px;
  font-weight: 700;
}
.reply .avatar {
  width: 18px;
  height: 18px;
  font-size: 9px;
}
.author {
  min-width: 0;
  overflow: hidden;
  color: rgb(233, 234, 237);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  flex: none;
  margin-left: auto;
  padding-left: 16px;
  color: rgb(127, 132, 141);
}
/* Sits over the bubble's bottom-right corner. A hovered bubble is raised so
   its button isn't hidden under a neighbour, such as a reply below it. */
.bubble:hover {
  z-index: 1;
}
.reply-button {
  position: absolute;
  right: -10px;
  bottom: -10px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgb(51, 57, 81);
  border-radius: 50%;
  background: rgb(34, 37, 43);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  color: rgb(127, 132, 141);
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease, background 150ms ease, color 150ms ease;
}
.bubble:hover .reply-button,
.reply-button:focus-visible {
  opacity: 1;
}
.reply-button:hover {
  background: rgb(51, 57, 81);
  color: rgb(233, 234, 237);
}
.reply-button svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}
.connector {
  position: absolute;
  box-sizing: border-box;
  border-bottom: 2px solid rgb(68, 77, 111);
  border-left: 2px solid rgb(68, 77, 111);
  border-bottom-left-radius: 8px;
  transition: top 300ms ease, left 300ms ease, width 300ms ease, height 300ms ease;
}
`

interface Panel {
  host: HTMLElement
  pageStyle: HTMLStyleElement
  // Scrolls through the canvas, which holds the bubbles.
  stage: HTMLElement
  canvas: HTMLElement
  jumpButton: HTMLButtonElement
  // Whether the stage keeps scrolling to the newest message. Turns off when
  // the viewer scrolls up.
  following: boolean
  // Until when scroll events count as the viewer's own. Scrolling done by
  // the panel itself never changes `following`.
  userScrollUntil: number
  // Whether the viewer is dragging the scrollbar.
  dragging: boolean
  // The layout y at the top of the canvas.
  origin: number
  composer: Composer
  // Relays out the bubbles when the stage changes size, such as when the
  // composer's reply bar appears.
  stageObserver: ResizeObserver
  // Sits under the bubbles, holding the reply connector lines.
  connectorLayer: HTMLElement
  layout: ChatLayout
  // Oldest first.
  messages: ChatMessage[]
  elements: Map<string, HTMLElement>
  // Connector lines, keyed by the id of the reply they lead to.
  connectors: Map<string, HTMLElement>
  // Seed for laying out from scratch, so a relayout picks the same spots
  // whenever the bubble sizes haven't changed.
  seed: number
}

let panel: Panel | null = null
let resizeTimer: ReturnType<typeof setTimeout> | undefined

function remInPixels(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize)
  if (Number.isFinite(size) && size > 0) {
    return size
  }
  else {
    return 16
  }
}

function readLayoutOptions(stage: HTMLElement): LayoutOptions {
  const rem = remInPixels()
  return {
    width: stage.clientWidth,
    maxBubbles: MAX_MESSAGES,
    margin: rem,
    gap: 2 * rem,
    replyGap: REPLY_GAP,
    indent: REPLY_INDENT,
    drop: 2 * rem,
    minDrop: 1.5 * rem,
    step: rem,
    push: 3 * rem,
    lift: 10 * rem,
  }
}

// Keeps the panel below YouTube's top bar.
function positionHost(host: HTMLElement) {
  const masthead = document.querySelector('#masthead-container')
  const top      = masthead?.getBoundingClientRect().bottom ?? 0
  host.style.cssText =
    `position: fixed; top: ${top}px; right: 0; bottom: 0; width: 50vw; z-index: 2000;`
}

// A curved "reply" arrow.
const REPLY_ICON_PATH = 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z'

function createReplyButton(message: ChatMessage): HTMLButtonElement {
  const button = createButton('reply-button', '', `Reply to ${message.author}`)
  const icon   = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path   = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  icon.setAttribute('viewBox', '0 0 24 24')
  path.setAttribute('d', REPLY_ICON_PATH)
  icon.append(path)
  button.append(icon)
  button.addEventListener('click', () => panel?.composer.startReply(message))
  return button
}

function createBubble(message: ChatMessage): HTMLElement {
  const bubble = createElement('bubble', '')
  const header = createElement('header', '')
  const avatar = createElement('avatar', authorInitial(message.author))
  const time   = createElement('time', videoTimeLabel(message))
  avatar.style.background = avatarColor(message.author)
  header.append(avatar, createElement('author', message.author), time)
  bubble.append(
    header,
    createElement('text', message.message),
    createReplyButton(message),
  )
  return bubble
}

// Where in the video the message was sent, or nothing when unknown.
function videoTimeLabel(message: ChatMessage): string {
  if (message.videoTime === undefined) {
    return ''
  }
  else {
    return formatVideoTime(message.videoTime)
  }
}

// Adds a hidden bubble to the canvas and returns it with its rendered size.
// It shrinks to fit its text, up to MAX_BUBBLE_WIDTH of the panel.
function measureBubble(
  current: Panel,
  message: ChatMessage,
): { element: HTMLElement; bubble: NewBubble } {
  const element = createBubble(message)
  element.classList.add('measuring')
  element.style.width    = 'max-content'
  element.style.maxWidth = `${MAX_BUBBLE_WIDTH * current.stage.clientWidth}px`
  current.canvas.append(element)
  // Round fractional sizes up: rounding the width down would make the text
  // wrap onto an extra line once the bubble is given that width.
  const size   = element.getBoundingClientRect()
  const bubble = {
    id: message.id,
    parentId: message.in_reply_to ?? null,
    width: Math.ceil(size.width),
    height: Math.ceil(size.height),
  }
  return { element, bubble }
}

// Moves every bubble to its place in the layout and removes the ones the
// layout dropped.
function render(current: Panel) {
  const view = viewport(current.layout, current.stage.clientHeight, remInPixels())
  current.origin = view.origin
  current.canvas.style.height = `${view.height}px`

  const placed = new Set<string>()
  for (const bubble of current.layout.bubbles) {
    const element = current.elements.get(bubble.id)
    if (element === undefined) {
      continue
    }
    else {
      placed.add(bubble.id)
      element.classList.toggle('reply', bubble.anchorId !== null)
      element.style.left  = `${bubble.x}px`
      element.style.top   = `${bubble.y - view.origin}px`
      element.style.width = `${bubble.width}px`
    }
  }

  for (const [id, element] of current.elements) {
    if (!placed.has(id)) {
      element.remove()
      current.elements.delete(id)
    }
  }

  renderConnectors(current, view.origin)
}

function renderConnectors(current: Panel, origin: number) {
  const lines = connectors(current.layout, CONNECTOR_SPINE, CONNECTOR_ELBOW)
  const drawn = new Set(lines.map((line) => line.id))
  for (const line of lines) {
    const existing = current.connectors.get(line.id)
    const element  = existing ?? createElement('connector', '')
    if (existing === undefined) {
      current.connectors.set(line.id, element)
      current.connectorLayer.append(element)
    }
    element.style.left   = `${line.left}px`
    element.style.top    = `${line.top - origin}px`
    element.style.width  = `${line.width}px`
    element.style.height = `${line.height}px`
  }

  for (const [id, element] of current.connectors) {
    if (!drawn.has(id)) {
      element.remove()
      current.connectors.delete(id)
    }
  }
}

function isAtBottom(stage: HTMLElement): boolean {
  return stage.scrollHeight - stage.scrollTop - stage.clientHeight < BOTTOM_THRESHOLD
}

function setFollowing(current: Panel, following: boolean) {
  current.following         = following
  current.jumpButton.hidden = following
}

function scrollToLatest(current: Panel, smooth: boolean) {
  const target = current.stage.scrollHeight - current.stage.clientHeight
  if (Math.abs(target - current.stage.scrollTop) < 1) {
    return
  }
  else if (smooth) {
    current.stage.scrollTo({ top: target, behavior: 'smooth' })
  }
  else {
    current.stage.scrollTop = target
  }
}

// Renders, then either scrolls to the newest message or, when the viewer
// has scrolled up, keeps what they're reading where it was.
function renderAndScroll(current: Panel, smooth: boolean) {
  const previousOrigin = current.origin
  render(current)
  if (current.following) {
    scrollToLatest(current, smooth)
  }
  else {
    // A higher origin shifts everything down the canvas by the difference.
    current.stage.scrollTop += previousOrigin - current.origin
  }
}

// Shows a freshly placed bubble without animating it in from nowhere.
function reveal(element: HTMLElement) {
  // Apply its position before re-enabling transitions.
  element.getBoundingClientRect()
  element.classList.remove('measuring')
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease' })
}

// Lays out `messages` (oldest first) on the panel from scratch, replacing
// whatever it showed.
export function showMessages(messages: readonly ChatMessage[]) {
  if (panel === null) {
    return
  }
  else {
    const current = panel
    const options = readLayoutOptions(current.stage)
    current.elements.forEach((element) => element.remove())
    current.elements.clear()
    current.connectors.forEach((element) => element.remove())
    current.connectors.clear()

    const measured = messages.map((message) => {
      const { element, bubble } = measureBubble(current, message)
      current.elements.set(message.id, element)
      return bubble
    })
    current.layout   = layoutMessages(measured, options, current.seed)
    current.messages = messages.slice(-MAX_MESSAGES)
    renderAndScroll(current, false)
    current.elements.forEach((element) => element.classList.remove('measuring'))
  }
}

// Places one new message below the others, and scrolls to it unless the
// viewer has scrolled up to read older messages.
export function showMessage(message: ChatMessage) {
  if (panel === null || panel.elements.has(message.id)) {
    return
  }
  else {
    const current = panel
    const options = readLayoutOptions(current.stage)
    const { element, bubble } = measureBubble(current, message)

    current.elements.set(message.id, element)
    current.layout   = placeMessage(current.layout, bubble, options)
    current.messages = [...current.messages, message].slice(-MAX_MESSAGES)
    renderAndScroll(current, true)
    reveal(element)
  }
}

function scheduleRelayout() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (panel !== null) {
      positionHost(panel.host)
      showMessages(panel.messages)
    }
  }, RESIZE_DEBOUNCE_MS)
}

// Shows the panel. `send` posts what the viewer types in its message box.
export function mountPanel(send: SendMessage) {
  if (panel !== null) {
    return
  }
  else {
    const pageStyle = document.createElement('style')
    pageStyle.textContent = PAGE_STYLE
    document.head.append(pageStyle)

    const host = document.createElement('div')
    host.id = 'constellate-panel'
    positionHost(host)
    const root     = host.attachShadow({ mode: 'open' })
    const style    = document.createElement('style')
    const frame    = createElement('frame', '')
    const wrap     = createElement('stage-wrap', '')
    const stage    = createElement('stage', '')
    const canvas   = createElement('canvas', '')
    const composer = createComposer(send)
    const connectorLayer = createElement('connectors', '')
    const jumpButton     =
      createButton('jump-button', 'Jump to latest ↓', 'Jump to latest')
    style.textContent = PANEL_STYLE + COMPOSER_STYLE
    jumpButton.hidden = true
    canvas.append(connectorLayer)
    stage.append(canvas)
    wrap.append(stage, jumpButton)
    frame.append(wrap, composer.element)
    root.append(style, frame)
    document.body.append(host)

    // Only the viewer's own scrolling turns following off (scrolling up) or
    // back on (scrolling to the bottom).
    const noteUserScroll = () => {
      if (panel !== null) {
        panel.userScrollUntil = Date.now() + USER_SCROLL_MS
      }
    }
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      stage.addEventListener(type, noteUserScroll, { passive: true })
    }
    stage.addEventListener('pointerdown', () => {
      if (panel !== null) {
        panel.dragging = true
      }
    })
    const endDrag = () => {
      if (panel !== null) {
        panel.dragging = false
        setFollowing(panel, isAtBottom(stage))
      }
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    stage.addEventListener('scroll', () => {
      if (panel !== null && (panel.dragging || Date.now() < panel.userScrollUntil)) {
        setFollowing(panel, isAtBottom(stage))
      }
    })
    jumpButton.addEventListener('click', () => {
      if (panel !== null) {
        setFollowing(panel, true)
        scrollToLatest(panel, true)
      }
    })

    const stageObserver = new ResizeObserver(scheduleRelayout)
    stageObserver.observe(stage)

    const seed = Math.floor(Math.random() * 2 ** 32)
    panel = {
      host,
      pageStyle,
      stage,
      canvas,
      jumpButton,
      following: true,
      userScrollUntil: 0,
      dragging: false,
      origin: 0,
      composer,
      stageObserver,
      connectorLayer,
      layout: emptyLayout(seed),
      messages: [],
      elements: new Map(),
      connectors: new Map(),
      seed,
    }
    window.addEventListener('resize', scheduleRelayout)
    // Let YouTube resize the player to the narrower column.
    window.dispatchEvent(new Event('resize'))
  }
}

export function unmountPanel() {
  if (panel === null) {
    return
  }
  else {
    window.removeEventListener('resize', scheduleRelayout)
    clearTimeout(resizeTimer)
    panel.stageObserver.disconnect()
    panel.host.remove()
    panel.pageStyle.remove()
    panel = null
    window.dispatchEvent(new Event('resize'))
  }
}
