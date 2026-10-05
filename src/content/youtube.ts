import {
  isChatReplyResult,
  type ChatMessage,
  type ChatReplyResult,
  type ChatMessagesUpdate,
} from '../shared/chat'
import { mountPanel, showMessage, unmountPanel } from './panel'

const CHAT_SELECTOR = '.style-scope.yt-live-chat-item-list-renderer'
const AUTHOR_CHIP_SELECTOR = 'yt-live-chat-author-chip'
const PRIMARY_SELECTOR = '#primary-inner'
const CHECK_INTERVAL_MS = 1000

function getChatDocuments(): Document[] {
  const docs: Document[] = [document]
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      if (iframe.contentDocument) {
        docs.push(iframe.contentDocument)
      }
    } catch {
      // Cross-origin iframe; skip.
    }
  }
  return docs
}

function findChatElements(docs: Document[]): Element[] {
  return docs.flatMap((doc) => [
    ...doc.querySelectorAll(CHAT_SELECTOR)
  ])
}

function readText(el: Element | null): string {
  if (!el) {
    return ''
  }
  else {
    return [...el.childNodes]
      .map((node) =>
        node instanceof Element && node.tagName === 'IMG'
          ? (node.getAttribute('alt') ?? '')
          : (node.textContent ?? ''),
      )
      .join('')
      .trim()
  }
}

function readChatMessage(chip: Element, timestamp: number): ChatMessage | null {
  const author = readText(chip.querySelector('#author-name'))
  // Each message renderer is a direct child of #items, with YouTube's message
  // id as its element id.
  const id = chip.closest('#items > *')?.id ?? ''
  if (author.length === 0 || id.length === 0) {
    return null
  }
  else {
    const container = chip.closest('#content') ?? chip.parentElement
    const message   = readText(container?.querySelector('#message') ?? null)
    return { id, author, message, timestamp }
  }
}

function getVideoId(href: string): string | null {
  return new URL(href).searchParams.get('v')
}

function sendChatMessages(messages: ChatMessage[]) {
  const videoId = getVideoId(location.href)
  if (videoId === null || messages.length === 0) {
    return
  }
  else {
    const update: ChatMessagesUpdate = { type: 'chat-messages', videoId, messages }
    chrome.runtime.sendMessage(update).catch((error: unknown) => {
      console.warn('[Constellate] Failed to send chat messages:', error)
    })
  }
}

const seenChips = new WeakSet<Element>()
const observedDocs = new WeakSet<Document>()

function readNewMessages(root: ParentNode): ChatMessage[] {
  const messages: ChatMessage[] = []
  const now = Date.now()
  for (const chip of root.querySelectorAll(AUTHOR_CHIP_SELECTOR)) {
    if (seenChips.has(chip)) {
      continue
    }
    else {
      const message = readChatMessage(chip, now)
      // Leave unreadable chips unseen so a later pass can pick them up.
      if (!message) {
        continue
      }
      else {
        seenChips.add(chip)
        messages.push(message)
      }
    }
  }
  return messages
}

function watchChat(doc: Document) {
  if (observedDocs.has(doc) || !doc.body) {
    return
  }
  else {
    const initial = readNewMessages(doc)
    
    if (initial.length === 0) {
      return
    }
    else {
      observedDocs.add(doc)
      console.log(`[Constellate] Read ${initial.length} chat messages:`, initial)
      sendChatMessages(initial)

      // YouTube may stamp a message element before filling in its content,
      // so read on the next tick after a mutation batch.
      let pending = false
      new MutationObserver(() => {
        if (pending) {
          return
        }
        else {
          pending = true
          setTimeout(() => {
            pending = false
            const messages = readNewMessages(doc)
            for (const message of messages) {
              console.log('[Constellate] New chat message:', message)
            }
            sendChatMessages(messages)
          }, 0);
        }
      }).observe(doc.body, { childList: true, subtree: true })
    }
  }
}

function hideChat(chatElements: Element[]) {
  // Hide the list renderer itself so newly arriving chat items stay hidden too.
  for (const el of chatElements) {
    const renderer = (el.closest('yt-live-chat-item-list-renderer') ?? el) as HTMLElement
    renderer.style.setProperty('display', 'none', 'important')
  }
}

// The video whose chat the panel is showing, or null when not on a video.
let shownVideoId: string | null = null

function getWatchedVideoId(): string | null {
  return location.pathname.includes('/watch') ? getVideoId(location.href) : null
}

function check() {
  const videoId = getWatchedVideoId()
  if (videoId !== shownVideoId) {
    // Clear the previous video's panel; it's mounted again once chat shows up.
    unmountPanel()
    shownVideoId = videoId
  }

  if (videoId === null) {
    return
  }
  else {
    const docs = getChatDocuments()
    docs.forEach(watchChat)

    const chatElements = findChatElements(docs)
    const primary      = document.querySelector(PRIMARY_SELECTOR)

    if (primary !== null && chatElements.length > 0) {
      hideChat(chatElements)
      mountPanel()
    }
  }
}

// YouTube is a single-page app and loads chat asynchronously inside an
// iframe, so poll rather than relying on page load or a MutationObserver on
// this document.
check()
setInterval(check, CHECK_INTERVAL_MS)
document.addEventListener('yt-navigate-finish', check)

function logReplyResult(result: ChatReplyResult) {
  if (result.original !== null) {
    console.log('[Constellate] Reply detected:', {
      score: result.score,
      reply: result.message,
      original: result.original,
    })
  }
  else {
    console.log('[Constellate] Not a reply:', {
      score: result.score,
      message: result.message,
    })
  }
}

// Messages are shown once the background has checked them for a reply
// target, so replies can be placed under the messages they answer.
chrome.runtime.onMessage.addListener((message) => {
  if (isChatReplyResult(message)) {
    logReplyResult(message)
    if (message.videoId === shownVideoId) {
      showMessage(message.message)
    }
  }
  return false
})
