import type { ChatMessage } from '../shared/chat'
import {
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
  padding: 6px 10px;
  border-radius: 12px;
  background: rgb(39, 39, 39);
  color: rgb(241, 241, 241);
  font: 13px/1.4 Roboto, Arial, sans-serif;
  overflow-wrap: anywhere;
  transition: top 300ms ease, left 300ms ease;
}
.bubble.reply {
  background: rgb(30, 42, 60);
}
.bubble.measuring {
  visibility: hidden;
  transition: none;
}
.author {
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(170, 170, 170);
}
`

interface Panel {
  host: HTMLElement
  pageStyle: HTMLStyleElement
  stage: HTMLElement
  layout: ChatLayout
  // Oldest first.
  messages: ChatMessage[]
  elements: Map<string, HTMLElement>
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
    drop: 2 * rem,
    step: rem,
    push: 3 * rem,
  }
}

// Keeps the panel below YouTube's top bar.
function positionHost(host: HTMLElement) {
  const masthead = document.querySelector('#masthead-container')
  const top      = masthead?.getBoundingClientRect().bottom ?? 0
  host.style.cssText =
    `position: fixed; top: ${top}px; right: 0; bottom: 0; width: 50vw; z-index: 2000;`
}

function createBubble(message: ChatMessage): HTMLElement {
  const element  = document.createElement('div')
  const author   = document.createElement('div')
  const text     = document.createElement('div')
  element.className  = message.in_reply_to === undefined ? 'bubble' : 'bubble reply'
  author.className   = 'author'
  author.textContent = message.author
  text.textContent   = message.message
  element.append(author, text)
  return element
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
    const stage = document.createElement('div')
    style.textContent = PANEL_STYLE
    stage.className   = 'stage'
    root.append(style, stage)
    document.body.append(host)

    const seed = Math.floor(Math.random() * 2 ** 32)
    panel = {
      host,
      pageStyle,
      stage,
      layout: emptyLayout(seed),
      messages: [],
      elements: new Map(),
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
