import React from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import * as bot from './lib/bot.mjs'
import { logRaw } from './lib/logger.mjs'
import { handleCommand } from './lib/commands.mjs'
import { startPassivePerception, stopPassivePerception } from './lib/perception/index.mjs'

function App() {
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const { exit } = useApp()

  const addMessage = (msg) => {
    setMessages(prev => [...prev, msg])
  }

  React.useEffect(() => {
    bot.createBot((event, data) => {
      switch (event) {
        case 'spawn':
          addMessage(logRaw('Bot 已进入游戏'))
          startPassivePerception((event) => {
            switch (event.type) {
              case 'damage':
                addMessage(logRaw(`⚠ 受到伤害 - 生命值: ${event.data.health} (-${event.data.damage})`))
                break
              case 'entity_attack':
                addMessage(logRaw(`⚠ ${event.data.name} 在攻击你! (${event.data.distance}m)`))
                break
              case 'entity_approach':
                addMessage(logRaw(`📍 ${event.data.name} 接近中 (${event.data.distance}m)`))
                break
              case 'entity_leave':
                addMessage(logRaw(`📍 ${event.data.name} 离开了`))
                break
            }
          })
          break
        case 'chat':
          addMessage(logRaw(`<${data.username}> ${data.message}`))
          break
        case 'messagestr':
          addMessage(logRaw('[消息] ' + data.msg))
          break
        case 'auto_login':
          addMessage(logRaw('已自动登录'))
          break
        case 'auto_register':
          addMessage(logRaw('已自动注册'))
          break
        case 'error':
          addMessage(logRaw('错误: ' + data.err))
          break
        case 'kicked':
          addMessage(logRaw('被踢出: ' + data.reason))
          stopPassivePerception()
          break
        case 'end':
          addMessage(logRaw('连接断开: ' + (data.reason || '未知原因')))
          stopPassivePerception()
          break
        case 'reconnect_start':
          addMessage(logRaw(`开始自动重连 (${data.attempt}/${data.max})`))
          break
        case 'reconnect_attempt':
          addMessage(logRaw(`正在重连... (第${data.attempt}次)`))
          break
      }
    })

    return () => {
      stopPassivePerception()
      bot.destroyBot()
    }
  }, [])

  useInput((inputChar, key) => {
    if (key.escape || (key.ctrl && inputChar === 'c')) {
      bot.destroyBot()
      exit()
    }
  })

  const handleSubmit = (value) => {
    const cmd = value.trim()
    setInput('')
    if (!cmd) return

    const handled = handleCommand(cmd, { addMessage, exit })
    if (!handled) {
      addMessage(logRaw('[发送] ' + cmd))
      bot.chat(cmd)
    }
  }

  return React.createElement(Box, { flexDirection: 'column', height: '100%' },
    React.createElement(Box, {
      flexDirection: 'column',
      flexGrow: 1,
      flexShrink: 1,
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
      flexShrink: 0,
      borderStyle: 'round',
      borderColor: 'green',
      padding: 0
    },
      React.createElement(TextInput, {
        value: input,
        onChange: setInput,
        onSubmit: handleSubmit,
        placeholder: '> '
      })
    )
  )
}

render(React.createElement(App), {
  exitOnCtrlC: false,
  patchConsole: false,
  alternateScreen: true
})
