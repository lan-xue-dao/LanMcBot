# mcbot

Minecraft 机器人，基于 mineflayer。TUI 界面，模块化架构。

## 运行 / Run

```bash
npm start            # node index.js → 动态加载 tui.mjs
npm run mcp          # MCP 服务器 (stdio)
npm run mcp:sse      # MCP 服务器 (SSE)
```

## 配置 / Config

`config.json` — 服务器地址/端口、用户名、认证模式、密码。

## 项目结构 / Structure

```
index.js           # 入口，仅 import('./tui.mjs')
tui.mjs            # TUI 界面 (ink)
mcp-server.mjs     # MCP 服务器
lib/
  config.mjs       # 配置管理
  bot.mjs          # 机器人核心（创建/销毁/重连）
  commands.mjs     # 命令处理
  logger.mjs       # 日志模块
  perception/
    active/scan.mjs      # 主动感知（用户命令触发）
    passive/monitor.mjs  # 被动监听（环境变化自动触发）
```

## CLI 命令 / CLI Commands

中英文感叹号都支持。

| 命令 | 说明 |
|------|------|
| `!help` | 显示帮助 |
| `!exit` / `!quit` | 退出 |
| `!restart` | 重启 |
| `!connect` | 连接服务器 |
| `!reconnect` | 手动重连 |
| `!mcp` | 开关 MCP 服务器 |
| `!mcp-stdio` / `!mcp-sse` | 切换 MCP 传输模式 |
| `!scan` | 扫描周围环境 |
| `!players` | 扫描附近玩家 |
| `!entities` | 扫描附近实体 |
| `!blocks` | 扫描周围方块 |
| `!find <方块名>` | 查找特定方块 |
| `!danger` | 评估危险等级 |

## 注意事项 / Notes

- `package.json` 是 `"type": "commonjs"`，但 `tui.mjs` 等用 ESM，`index.js` 通过动态 `import()` 加载
- `lib/bot.mjs` 中 `loggedIn` 标志防止登录后重复触发自动登录
- 自动重连：断开后等待5秒重连，最多3次后停止
- 被动感知（受伤/被攻击/实体接近）自动显示在 TUI
- 日志写入 `chat_YYYY-MM-DD.log`（已 gitignore）
- TUI 使用 `alternateScreen`，退出时恢复终端
- Windows 下终端编码问题可能导致中文显示异常，运行 `chcp 65001`
