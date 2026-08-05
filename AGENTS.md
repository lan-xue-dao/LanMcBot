# mcbot

Minecraft 机器人，基于 mineflayer。单文件项目 (`index.js`)。

A Minecraft bot powered by mineflayer. Single-file project (`index.js`).

## 运行 / Run

```bash
npm start        # node index.js
```

## 配置 / Config

`config.json` — 服务器地址/端口、用户名、认证模式。运行前请修改。

`config.json` — server host/port, username, auth mode. Edit before running.

## 约定 / Conventions

- 机器人名称 / Bot name: LanBot
- 语言 / Language: 中文 (聊天消息、日志输出)
- 日志 / Logs: `chat_YYYY-MM-DD.log` (已 gitignore)
- 认证 / Auth: 默认离线模式 / offline mode by default
