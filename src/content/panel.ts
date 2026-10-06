import type { ChatMessage } from '../shared/chat'
import { authorInitial, avatarColor, formatVideoTime } from './format'
import {
  connectors,
  emptyLayout,
  layoutMessages,
  placeMessage,
  type ChatLayout,
  type LayoutOptions,
  type NewBubble,
} from './layout'

// Bubbles shrink to fit their text, up to this fraction of the panel width.
const MAX_BUBBLE_WIDTH = 0.3
// Recent messages kept so the panel can be laid out again after a resize.
const MAX_REMEMBERED_MESSAGES = 300
const RESIZE_DEBOUNCE_MS = 150

// Reply chain geometry, in px, matched to the chat design.
const REPLY_GAP = 8
const REPLY_INDENT = 44
// Where the connector line leaves the chain's first message, from its left
// edge, and where it enters a reply, from its top.
const CONNECTOR_SPINE = 20
const CONNECTOR_ELBOW = 17

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
.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: rgb(15, 15, 15);
}
.bubble {
  position: absolute;
  box-sizing: border-box;
  padding: 16px 18px 18px;
  border: 1px solid rgb(34, 37, 43);
  border-radius: 12px;
  background: rgb(25, 27, 31);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: rgb(212, 214, 219);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
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
  gap: 10px;
  height: 28px;
  margin-bottom: 10px;
}
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: rgb(17, 19, 21);
  font-size: 13px;
  font-weight: 700;
}
.reply .avatar {
  width: 24px;
  height: 24px;
  font-size: 11px;
}
.author {
  min-width: 0;
  overflow: hidden;
  color: rgb(233, 234, 237);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  flex: none;
  margin-left: auto;
  padding-left: 16px;
  color: rgb(127, 132, 141);
  font-size: 13px;
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
  stage: HTMLElement
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
    height: stage.clientHeight,
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

function createElement(className: string, text: string): HTMLElement {
  const element = document.createElement('div')
  element.className   = className
  element.textContent = text
  return element
}

function createBubble(message: ChatMessage): HTMLElement {
  const bubble = createElement('bubble', '')
  const header = createElement('header', '')
  const avatar = createElement('avatar', authorInitial(message.author))
  const time   = createElement('time', videoTimeLabel(message))
  avatar.style.background = avatarColor(message.author)
  header.append(avatar, createElement('author', message.author), time)
  bubble.append(header, createElement('text', message.message))
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

// Adds a hidden bubble to the stage and returns it with its rendered size.
// It shrinks to fit its text, up to MAX_BUBBLE_WIDTH of the panel.
function measureBubble(
  stage: HTMLElement,
  message: ChatMessage,
): { element: HTMLElement; bubble: NewBubble } {
  const element = createBubble(message)
  element.classList.add('measuring')
  element.style.width    = 'max-content'
  element.style.maxWidth = `${MAX_BUBBLE_WIDTH * stage.clientWidth}px`
  stage.append(element)
  const bubble = {
    id: message.id,
    parentId: message.in_reply_to ?? null,
    width: element.offsetWidth,
    height: element.offsetHeight,
  }
  return { element, bubble }
}

// Moves every bubble to its place in the layout and removes the ones the
// layout dropped off the top of the panel.
function render(current: Panel) {
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
      element.style.top   = `${bubble.y}px`
      element.style.width = `${bubble.width}px`
    }
  }

  for (const [id, element] of current.elements) {
    if (!placed.has(id)) {
      element.remove()
      current.elements.delete(id)
    }
  }

  renderConnectors(current)
}

function renderConnectors(current: Panel) {
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
    element.style.top    = `${line.top}px`
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
      const { element, bubble } = measureBubble(current.stage, message)
      current.elements.set(message.id, element)
      return bubble
    })
    current.layout   = layoutMessages(measured, options, current.seed)
    current.messages = messages.slice(-MAX_REMEMBERED_MESSAGES)
    render(current)
    current.elements.forEach((element) => element.classList.remove('measuring'))
  }
}

// Places one new message and scrolls everything up so it sits at the bottom
// of the panel.
export function showMessage(message: ChatMessage) {
  if (panel === null || panel.elements.has(message.id)) {
    return
  }
  else {
    const current = panel
    const options = readLayoutOptions(current.stage)
    const { element, bubble } = measureBubble(current.stage, message)

    current.elements.set(message.id, element)
    current.layout   = placeMessage(current.layout, bubble, options)
    current.messages = [...current.messages, message].slice(-MAX_REMEMBERED_MESSAGES)
    render(current)
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

export function mountPanel() {
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
    const root  = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    const stage = createElement('stage', '')
    const connectorLayer = createElement('connectors', '')
    style.textContent = PANEL_STYLE
    stage.append(connectorLayer)
    root.append(style, stage)
    document.body.append(host)

    const seed = Math.floor(Math.random() * 2 ** 32)
    panel = {
      host,
      pageStyle,
      stage,
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
    panel.host.remove()
    panel.pageStyle.remove()
    panel = null
    window.dispatchEvent(new Event('resize'))
  }
}
