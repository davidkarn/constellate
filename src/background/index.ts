import { createTaskQueue } from '../lib'
import {
  chatHistoryKey,
  findNewMessages,
  isChatMessagesUpdate,
  mergeChatHistory,
  type ChatMessage,
  type ChatMessagesUpdate,
  type ChatReplyResult,
} from '../shared/chat'
import {
  MAX_REPLY_CANDIDATES,
  REPLY_SCORE_THRESHOLD,
  buildReplyDecisionRequest,
  decideReply,
  findReplyCandidates,
  linkReply,
  parseReplyScores,
  type ChatThread,
  type ReplyDecision,
} from '../shared/replies'
import { getOpenRouterApiKey } from '../shared/settings'
import { requestDecision } from './openrouter'

chrome.runtime.onInstalled.addListener(() => {
  console.log('Constellate installed')
})

// History writes run one at a time so overlapping updates can't overwrite
// each other's read-modify-write of the same history.
const storageQueue = createTaskQueue()
// Messages are checked one at a time, oldest first, so each check sees the
// reply links found for the messages before it.
const analysisQueue = createTaskQueue()

async function readHistory(videoId: string): Promise<ChatMessage[]> {
  const key = chatHistoryKey(videoId)
  const stored = await chrome.storage.session.get(key)
  return (stored[key] as ChatMessage[] | undefined) ?? []
}

interface HistoryChange {
  before: ChatMessage[]
  after: ChatMessage[]
}

function updateHistory(
  videoId: string,
  update: (history: ChatMessage[]) => ChatMessage[],
): Promise<HistoryChange> {
  return storageQueue.run(async () => {
    const before = await readHistory(videoId)
    const after = update(before)
    await chrome.storage.session.set({ [chatHistoryKey(videoId)]: after })
    return { before, after }
  })
}

async function scoreReply(
  apiKey: string,
  message: ChatMessage,
  candidates: ChatThread[],
): Promise<ReplyDecision> {
  if (candidates.length === 0) {
    return { inReplyTo: null, score: null }
  }
  else {
    const request  = buildReplyDecisionRequest(message, candidates)
    const response = await requestDecision(apiKey, request)
    const scores   = parseReplyScores(response, candidates)
    return decideReply(scores, REPLY_SCORE_THRESHOLD)
  }
}

function sendReplyResult(tabId: number | undefined, result: ChatReplyResult) {
  if (tabId === undefined) {
    return
  }
  else {
    chrome.tabs.sendMessage(tabId, result).catch((error: unknown) => {
      console.warn('[Constellate] Failed to send reply result:', error)
    })
  }
}

async function analyzeMessage(
  apiKey: string,
  videoId: string,
  messageId: string,
  tabId: number | undefined,
) {
  const history = await readHistory(videoId)
  const message = history.find((entry) => entry.id === messageId)
  if (message === undefined) {
    return
  }
  else {
    const candidates = findReplyCandidates(history, messageId, MAX_REPLY_CANDIDATES)
    const { inReplyTo, score } = await scoreReply(apiKey, message, candidates)
    const updated =
      inReplyTo === null
        ? history
        : (await updateHistory(videoId, (h) => linkReply(h, messageId, inReplyTo))).after

    sendReplyResult(tabId, {
      type: 'chat-reply-result',
      videoId,
      message: updated.find((entry) => entry.id === messageId) ?? message,
      original: updated.find((entry) => entry.id === inReplyTo) ?? null,
      score,
    })
  }
}

async function handleChatMessages(update: ChatMessagesUpdate, tabId: number | undefined) {
  const { videoId, messages } = update
  const { before } = await updateHistory(videoId, (h) => mergeChatHistory(h, messages))
  const added = findNewMessages(before, messages)
  const apiKey = await getOpenRouterApiKey()

  if (added.length === 0) {
    return
  }
  else if (apiKey === null) {
    console.warn('[Constellate] No OpenRouter API key set; skipping reply detection.')
    return
  }
  else {
    for (const message of added) {
      analysisQueue
        .run(() => analyzeMessage(apiKey, videoId, message.id, tabId))
        .catch((error: unknown) => {
          console.error('[Constellate] Reply detection failed:', error)
        })
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ type: 'pong' })
    return false
  }
  else if (isChatMessagesUpdate(message)) {
    // Respond once the messages are saved; reply detection continues after.
    handleChatMessages(message, sender.tab?.id).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => {
        console.error('[Constellate] Failed to save chat messages:', error)
        sendResponse({ ok: false })
      },
    )
    // Keep the channel open for the async response.
    return true
  }
  else {
    return false
  }
})
