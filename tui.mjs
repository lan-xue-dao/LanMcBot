const CORNER_ROWS = 4
const CORNER_WIDTH = 40
let notifications = []
let renderScheduled = false

function displayWidth(str) {
  let w = 0
  for (const ch of str) {
    w += ch.codePointAt(0) > 0x2e7f ? 2 : 1
  }
  return w
}

function truncate(str, maxWidth) {
  let out = ''
  let w = 0
  for (const ch of str) {
    const cw = ch.codePointAt(0) > 0x2e7f ? 2 : 1
    if (w + cw > maxWidth) break
    out += ch
    w += cw
  }
  return out
}

export function notify(text) {
  notifications.unshift(text)
  if (notifications.length > CORNER_ROWS) notifications.pop()
  render()
}

export function render() {
  if (!process.stdout.isTTY) return

  const cols = process.stdout.columns || 80
  const rows = process.stdout.rows || 24
  if (cols < 50 || rows < 10) return

  const x = cols - CORNER_WIDTH - 1
  process.stdout.write('\x1b[s')

  for (let i = 0; i < CORNER_ROWS; i++) {
    const y = i + 1
    process.stdout.write(`\x1b[${y};${x}H\x1b[K`)
    let line
    if (i === 0) {
      line = '── 感知通知 ──'
      process.stdout.write('\x1b[36m')
    } else if (notifications[i - 1]) {
      line = notifications[i - 1]
      process.stdout.write('\x1b[33m')
    } else {
      line = ''
      process.stdout.write('\x1b[0m')
    }
    const padded = truncate(line, CORNER_WIDTH)
    const fill = CORNER_WIDTH - displayWidth(padded)
    process.stdout.write(padded + ' '.repeat(fill > 0 ? fill : 0))
    process.stdout.write('\x1b[0m')
  }

  process.stdout.write('\x1b[u')
}

export function reset() {
  notifications = []
  if (process.stdout.isTTY) process.stdout.write('\x1b[0m')
}
