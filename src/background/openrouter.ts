import type { DecisionRequest } from '../shared/replies'

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'

// Returns the parsed JSON response body.
export async function requestDecision(
  apiKey: string,
  request: DecisionRequest,
): Promise<unknown> {
  const response = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Constellate',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`)
  }
  else {
    return response.json()
  }
}
