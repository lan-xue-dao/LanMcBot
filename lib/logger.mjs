import fs from 'fs'

const logFile = `chat_${new Date().toISOString().slice(0,10)}.log`

export function log(msg) {
  const time = new Date().toLocaleString('zh-CN')
  const line = `[${time}] ${msg}`
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
  return line
}

export function logRaw(msg) {
  const time = new Date().toLocaleString('zh-CN')
  const line = `[${time}] ${msg}`
  fs.appendFileSync(logFile, line + '\n')
  return line
}
