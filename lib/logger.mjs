import fs from 'fs'

// 聊天记录与 bot 本体日志分离：
//   chat_YYYY-MM-DD.log — 纯聊天记录（游戏内消息流，含系统播报）
//   bot_YYYY-MM-DD.log   — bot 本体运行日志（连接/重连/寻路/感知/错误/命令反馈）
const today = () => new Date().toISOString().slice(0, 10)
const stamp = () => new Date().toLocaleString('zh-CN')

function append(file, line) {
  try {
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {}
}

// 聊天记录：只写 chat 文件，不打印控制台（由 UI 负责展示）
export function chatLog(msg) {
  const line = `[${stamp()}] ${msg}`
  append(`chat_${today()}.log`, line)
  return line
}

// 本体运行日志：打印控制台 + 写 bot 文件
export function log(msg) {
  const line = `[${stamp()}] ${msg}`
  console.log(line)
  append(`bot_${today()}.log`, line)
  return line
}

// 与 log 相同，但只在调用方决定展示（UI 里 addMessage(logRaw(...)) 用）
export function logRaw(msg) {
  const line = `[${stamp()}] ${msg}`
  append(`bot_${today()}.log`, line)
  return line
}