# mcbot

Minecraft 机器人（mineflayer），双模式界面：全屏 TUI / 纯 CLI，模块化架构，ESM 与 CommonJS 混合。

## 运行 / Run

```bash
npm start            # 入口 index.js → 按 config.ui 加载 cli.mjs 或 tui.mjs
npm run mcp          # MCP 服务器 (stdio)
npm run mcp:sse      # MCP 服务器 (SSE)
npm run mcp:stdio    # MCP 服务器 (stdio)
```

双模式切换：`node index.js --tui` / `--cli` 覆盖 `config.json` 的 `"ui": "cli"|"tui"`。

## 配置 / Config

`config.json` — host / port / username / auth / password / ui。

## 项目结构 / Structure

```
index.js           # 入口，动态 import() 加载 cli.mjs 或 tui.mjs
cli.mjs            # 纯 CLI 模式（readline，无状态覆盖）
tui.mjs            # 全屏 TUI 模式（自研 ANSI 重绘，非 ink）
mcp-server.mjs     # MCP 服务器
lib/
  bot.mjs          # 机器人核心：连接/重连/寻路/聊天指令
  commands.mjs     # CLI 命令（!前缀）
  i18n.mjs         # 中文翻译查询（配合 lib/data/zh_cn.json）
  config.mjs / logger.mjs
  perception/
    active/scan.mjs      # 主动感知（命令触发，16×16×16 立方体，radius 8）
    passive/monitor.mjs  # 被动监听（受伤/攻击/实体接近，过滤物品实体）
```

## 命令 / Commands

### CLI 命令（`!` 或全角 `！` 均支持）

- 移动：`!f/前` `!b/后` `!l/左` `!r/右` `!jump` `!sneak` `!stop` `!move <x> <y> <z>`（寻路）
- 动作：`!attack` `!use` `!sleep` `!wake`
- 感知：`!scan` `!players` `!entities` `!blocks` `!find <方块名>`（支持中文名）`!danger`
- 背包：`!inv` `!count <物品>` `!place <方块> <x> <y> <z> [px py pz]`（可选站位）
- 系统：`!help` `!exit/!quit` `!restart` `!connect` `!reconnect` `!mcp` `!mcp-stdio` `!mcp-sse`

### 聊天指令（唤醒词触发）

格式：`LanBot <cmd>`，唤醒词忽略大小写但**必须完整匹配 lanbot**（`lan` 不触发）。

- 支持：`help`、`move <x> <y> <z>`、`sleep`、`wake`、`attack`、`丢 <物> [数量]`、`背包`、`数量 <物>`、`place <方块> <x> <y> <z> [px py pz]`
- 不带唤醒词时 `丢`/`背包`/`数量` 仍可用；未知唤醒指令回复「未知指令」
- 聊天帮助是**单条消息**，用 `\n` 换行，格式与 `!help` 一致
- 任意玩家发 `hello` 会自动回复「你好 <玩家>！」

## 注意事项 / Notes

- `package.json` 是 `"type": "commonjs"`，界面与库文件用 `.mjs` ESM，`index.js` 动态 `import()` 加载；新增文件注意扩展名
- 寻路已配置：`canDig=false`（不破坏方块）、`canOpenDoors=true`、禁用跑酷/搭方块；到达用 `goal_reached` 事件（防抖 10s）
- 自动重连：断开后 5 秒重试，最多 3 次；重连后 3 秒自动补发 `/server <原服务器>` 回服
- 自动登录：`messagestr` 检测到 login/register 提示时自动用 `config.password`
- 翻译表 `lib/data/zh_cn.json` 为官方 mcmeta 1.20.4（6538 键）；`blockIdFromZh` 做中文方块名反查
- 被动感知只跟踪 8 格内实体，物品实体已过滤（防刷屏）
- 日志写入 `chat_YYYY-MM-DD.log`（已 gitignore）
- 无测试套件：改动后用 `node --check <file>` 验证语法，功能需连真实服务器验证
- Windows 下中文乱码时运行 `chcp 65001`
- TUI 用 alternateScreen 且退出恢复；PgUp/PgDn 滚动历史；SGR 鼠标序列已过滤；鼠标协议（?1000h/?1006h）曾引发输入错乱已回退，勿轻易重开
