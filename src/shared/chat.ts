import { sortBy, uniqueBy } from '../lib'

export interface ChatMessage {
  id: string
  author: string
  message: string
  // Milliseconds since the epoch.
  timestamp: number
  // Id of the message this one replies to.
  in_reply_to?: string
  // Ids of the messages that reply to this one.
  reply_to_this?: string[]
}

export interface ChatMessagesUpdate {
  type: 'chat-messages'
  videoId: string
  messages: ChatMessage[]
}

export function isChatMessagesUpdate(value: unknown): value is ChatMessagesUpdate {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'chat-messages'
  )
}

// Sent from the background to the content script once a message has been
// checked for a reply target.
export interface ChatReplyResult {
  type: 'chat-reply-result'
  videoId: string
  // The checked message, with in_reply_to set when a reply was found.
  message: ChatMessage
  // The message it replies to, with reply_to_this updated, or null.
  original: ChatMessage | null
  // The highest probability any earlier message/thread received, or null
  // when there was nothing earlier to compare against.
  score: number | null
}

export function isChatReplyResult(value: unknown): value is ChatReplyResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'chat-reply-result'
  )
}

export function chatHistoryKey(videoId: string): string {
  return `chatHistory:${videoId}`
}

// Existing entries win on duplicate ids, so a message keeps the timestamp it
// was first recorded with. The sort is stable, so messages sharing a
// timestamp stay in the order they were received.
export function mergeChatHistory(
  history: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const unique = uniqueBy([...history, ...incoming], (message) => message.id)
  return sortBy(unique, (message) => message.timestamp)
}

// The incoming messages that aren't already in the history, oldest first.
export function findNewMessages(
  history: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const known = new Set(history.map((message) => message.id))
  const unique = uniqueBy(incoming, (message) => message.id)
  const added = unique.filter((message) => !known.has(message.id))
  return sortBy(added, (message) => message.timestamp)
}
