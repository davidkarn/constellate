import { groupBy, maxBy, sortBy } from '../lib'
import type { ChatMessage } from './chat'

export const REPLY_MODEL = '~typesafe/jev-latest'
// A message counts as a reply only when its best probability is above this.
export const REPLY_SCORE_THRESHOLD = 0.65
// How many earlier messages/threads are offered to the model as choices.
export const MAX_REPLY_CANDIDATES = 40
// How many of a thread's latest messages are shown in its choice text.
const MAX_THREAD_MESSAGES_SHOWN = 5

const QUESTION_KEY = 'reply_to'
const NONE_OPTION  = 'none'

// A standalone message, or a chain of messages linked by in_reply_to, in
// chronological order.
export interface ChatThread {
  messages: ChatMessage[]
}

export interface ReplyScore {
  id: string
  score: number
}

export interface ReplyDecision {
  inReplyTo: string | null
  score: number | null
}

export interface DecisionRequest {
  model: string
  state: unknown
  questions: Record<string, unknown>
}

function latestMessage(thread: ChatThread): ChatMessage {
  return thread.messages[thread.messages.length - 1]
}

// Follows in_reply_to links back to the first message of the chain. Stops at
// a missing parent or a cycle.
function findThreadRoot(message: ChatMessage, byId: Map<string, ChatMessage>): string {
  const visited = new Set<string>()
  let current   = message
  while (current.in_reply_to !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    const parent = byId.get(current.in_reply_to)
    if (parent === undefined) {
      break
    }
    else {
      current = parent
    }
  }
  return current.id
}

// Groups chronological messages into threads, ordered by each thread's most
// recent message.
export function groupIntoThreads(messages: readonly ChatMessage[]): ChatThread[] {
  const byId    = new Map(messages.map((message) => [message.id, message]))
  const groups  = groupBy(messages, (message) => findThreadRoot(message, byId))
  const threads = [...groups.values()].map((group) => ({ messages: group }))
  return sortBy(threads, (thread) => latestMessage(thread).timestamp)
}

// The threads among the messages sent before `messageId` with the most
// recent activity, capped to `limit`, oldest activity first.
export function findReplyCandidates(
  history: readonly ChatMessage[],
  messageId: string,
  limit: number,
): ChatThread[] {
  const index = history.findIndex((message) => message.id === messageId)
  if (index === -1) {
    return []
  }
  else {
    return groupIntoThreads(history.slice(0, index)).slice(-limit)
  }
}

function optionKey(index: number): string {
  return `thread_${index + 1}`
}

function describeThread(thread: ChatThread): string {
  const lines = thread.messages
    .slice(-MAX_THREAD_MESSAGES_SHOWN)
    .map((message) => `${message.author}: ${message.message}`)
  if (thread.messages.length === 1) {
    return lines[0]
  }
  else {
    return `A conversation thread, ending with:\n${lines.join('\n')}`
  }
}

// One choice per candidate thread, plus "none" so the probabilities aren't
// forced onto a thread when the message isn't a reply.
export function buildReplyDecisionRequest(
  message: ChatMessage,
  candidates: readonly ChatThread[],
): DecisionRequest {
  const criteria = Object.fromEntries([
    ...candidates.map((thread, index) => [optionKey(index), describeThread(thread)]),
    [NONE_OPTION, 'The new message is not a reply to any of these messages or threads.'],
  ])
  return {
    model: REPLY_MODEL,
    state: {
      platform: 'YouTube live chat',
      new_message: { author: message.author, text: message.message },
    },
    questions: {
      [QUESTION_KEY]: {
        type: 'choice',
        instructions:
          'Which earlier chat message or conversation thread is the new message ' +
          'replying to? Most live chat messages are not replies; only pick a ' +
          'message or thread when there is clear evidence, such as mentioning ' +
          'its author, answering its question, or continuing its specific topic.',
        criteria,
      },
    },
  }
}

// Maps each thread's probability to the id of its latest message, which is
// the message a reply to that thread is linked to.
export function parseReplyScores(
  response: unknown,
  candidates: readonly ChatThread[],
): ReplyScore[] {
  const answers       = (response as { answers?: unknown } | null)?.answers
  const answer        = (answers as Record<string, unknown> | undefined)?.[QUESTION_KEY]
  const probabilities = (answer as { probabilities?: unknown } | undefined)?.probabilities
  if (typeof probabilities !== 'object' || probabilities === null) {
    return []
  }
  else {
    const byKey = probabilities as Record<string, unknown>
    return candidates.flatMap((thread, index) => {
      const score = byKey[optionKey(index)]
      if (typeof score === 'number' && Number.isFinite(score)) {
        return [{ id: latestMessage(thread).id, score }]
      }
      else {
        return []
      }
    })
  }
}

export function decideReply(
  scores: readonly ReplyScore[],
  threshold: number,
): ReplyDecision {
  const best = maxBy(scores, (score) => score.score)
  if (best === undefined) {
    return { inReplyTo: null, score: null }
  }
  else if (best.score > threshold) {
    return { inReplyTo: best.id, score: best.score }
  }
  else {
    return { inReplyTo: null, score: best.score }
  }
}

export function linkReply(
  history: readonly ChatMessage[],
  replyId: string,
  originalId: string,
): ChatMessage[] {
  return history.map((message) => {
    if (message.id === replyId) {
      return { ...message, in_reply_to: originalId }
    }
    else if (message.id === originalId) {
      const replies = message.reply_to_this ?? []
      if (replies.includes(replyId)) {
        return message
      }
      else {
        return { ...message, reply_to_this: [...replies, replyId] }
      }
    }
    else {
      return message
    }
  })
}
