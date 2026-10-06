import type { ChatMessage } from '../shared/chat'

// How long after sending a reply its echo in the chat is still matched to it.
const MATCH_WINDOW_MS = 2 * 60 * 1000

// A reply the viewer sent from the panel, waiting for YouTube to show it in
// the chat.
export interface OutgoingReply {
  text: string
  // Id of the message being replied to.
  replyTo: string
  sentAt: number
}

export interface Claim {
  // The replies still waiting, minus the one claimed and any expired ones.
  pending: OutgoingReply[]
  replyTo: string | null
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// Matches a chat message to the pending reply it's the echo of, by text.
export function claimOutgoing(
  pending: readonly OutgoingReply[],
  message: ChatMessage,
  now: number,
): Claim {
  const live  = pending.filter((reply) => now - reply.sentAt <= MATCH_WINDOW_MS)
  const text  = normalizeText(message.message)
  const index = live.findIndex((reply) => normalizeText(reply.text) === text)
  if (index === -1) {
    return { pending: live, replyTo: null }
  }
  else {
    return {
      pending: live.filter((_, i) => i !== index),
      replyTo: live[index].replyTo,
    }
  }
}
