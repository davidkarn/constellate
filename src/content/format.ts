// Avatar backgrounds, matched to the chat design.
const AVATAR_COLORS = [
  'rgb(132, 203, 132)',
  'rgb(193, 152, 255)',
  'rgb(243, 176, 102)',
  'rgb(149, 171, 255)',
]

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

// A video position like "0:05", "12:34" or "1:02:03", as YouTube shows it.
// Negative for messages sent before the video started.
export function formatVideoTime(seconds: number): string {
  const sign    = seconds < 0 ? '-' : ''
  const total   = Math.floor(Math.abs(seconds))
  const hours   = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest    = twoDigits(total % 60)
  if (hours > 0) {
    return `${sign}${hours}:${twoDigits(minutes)}:${rest}`
  }
  else {
    return `${sign}${minutes}:${rest}`
  }
}

// Parses a video position like "12:34", "1:02:03" or "-0:05" into seconds.
export function parseVideoTime(text: string): number | undefined {
  const match = /^(-)?(\d+(?::\d{1,2}){1,2})$/.exec(text.trim())
  if (match === null) {
    return undefined
  }
  else {
    const seconds = match[2]
      .split(':')
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0)
    return match[1] === undefined ? seconds : -seconds
  }
}

// The first character of an author's name, ignoring a leading "@".
export function authorInitial(author: string): string {
  const first = [...author.replace(/^@/, '')][0]
  return first === undefined ? '?' : first.toUpperCase()
}

// A stable avatar color per author.
export function avatarColor(author: string): string {
  const hash = [...author].reduce(
    (total, char) => (total * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
    0,
  )
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
