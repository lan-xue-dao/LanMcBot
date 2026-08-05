import React from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import mineflayer from 'mineflayer'
import fs from 'fs'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const config = require('./config.json')

const logFile = `chat_${new Date().toISOString().slice(0,10)}.log`

function log(msg) {
  const time = new Date().toLocaleString('zh-CN')
  const line = `[${time}] ${msg}`
  fs.appendFileSync(logFile, line + '\n')
  return line
}

let botInstance = null
let loggedIn = false

function App() {
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const { exit } = useApp()
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    const bot = mineflayer.createBot(config)
    botInstance = bot

    bot.on('spawn', () => {
      loggedIn = true
      setMessages(prev => [...prev, log('Bot 已进入游戏')])
    })

    bot.on('chat', (username, message) => {
      if (username === bot.username) return
      setMessages(prev => [...prev, log(`<${username}> ${message}`)])
      if (message === 'hello') {
        bot.chat(`你好 ${username}！`)
      }
    })

    bot.on('messagestr', msg => {
      setMessages(prev => [...prev, log('[消息] ' + msg)])
      if (loggedIn) return
      if (/login/i.test(msg)) {
        bot.chat('/login ' + config.password)
        setMessages(prev => [...prev, log('已自动登录')])
      } else if (/register/i.test(msg)) {
        bot.chat('/register ' + config.password + ' ' + config.password)
        setMessages(prev => [...prev, log('已自动注册')])
      }
    })

    bot.on('error', err => setMessages(prev => [...prev, log('错误: ' + err)]))
    bot.on('kicked', reason => setMessages(prev => [...prev, log('被踢出: ' + reason)]))

    return () => {
      if (botInstance) botInstance.quit()
    }
  }, [])

  useInput((inputChar, key) => {
    if (key.escape || (key.ctrl && inputChar === 'c')) {
      if (botInstance) botInstance.quit()
      exit()
    }
  })

  const handleSubmit = (value) => {
    const cmd = value.trim()
    setInput('')
    if (!cmd) return

    if (cmd === '！help' || cmd === '!help') {
      setMessages(prev => [...prev, log('可用命令：'), log('  ！help   - 显示帮助'), log('  ！exit   - 退出'), log('  ！quit   - 退出'), log('  ！restart - 重启')])
    } else if (cmd === '！exit' || cmd === '!exit' || cmd === '！quit' || cmd === '!quit') {
      if (botInstance) botInstance.quit()
      exit()
    } else if (cmd === '！restart' || cmd === '!restart') {
      if (botInstance) botInstance.quit()
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'inherit'
      })
      child.unref()
      exit()
    } else {
      setMessages(prev => [...prev, log('[发送] ' + cmd)])
      if (botInstance) botInstance.chat(cmd)
    }
  }

  return React.createElement(Box, { flexDirection: 'column', height: '100%' },
    React.createElement(Box, {
      flexDirection: 'column',
      flexGrow: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
      padding: 1
    },
      messages.slice(-50).map((msg, i) =>
        React.createElement(Text, { key: i }, msg)
      )
    ),
    React.createElement(Box, {
      flexDirection: 'column',
      height: 3,
      borderStyle: 'round',
      borderColor: 'green',
      padding: 0
    },
      React.createElement(TextInput, {
        ref: inputRef,
        value: input,
        onChange: setInput,
        onSubmit: handleSubmit,
        placeholder: '> '
      })
    )
  )
}

render(React.createElement(App))
