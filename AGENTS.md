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
  minimap.mjs      # 彩色小地图（俯视，按列最高方块采样）
  config.mjs / logger.mjs
  perception/
    index.mjs           # 感知统一导出（scan + monitor + environment）
    active/scan.mjs     # 主动感知（命令触发，16×16×16 立方体，radius 8）
    passive/monitor.mjs # 被动监听（受伤/攻击/实体接近，过滤物品实体）
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
- 寻路：`canDig=false`（不破坏方块）、`canOpenDoors=true`、`allowParkour=true`（翻半砖/栅栏）、`allow1by1towers=false`（不搭方块）；到达用 `goal_reached` 事件（防抖 10s）
- **门补丁**：mineflayer-pathfinder 的 `openable` 集合默认只含栅栏门（`name.includes('gate')`），普通木门被当墙；`setupPathfinder`（lib/bot.mjs）手动把非铁门 `*_door` 的 ID 加入 `movements.openable`
- **`Movements` 必须在 `spawn` 后创建**：`bot.registry` 连接后才有，`createBot` 时同步 `new Movements(bot)` 会崩 `registry.blocksByName`（历史上踩过）
- `path_update` 上报节流：同状态 2 秒内不重复（防刷屏）；`goal_reached` 10s 防抖
- 自动重连：断开后 5 秒重试，最多 3 次；重连后 3 秒自动补发 `/server <原服务器>` 回服
- 自动登录：`messagestr` 检测到 login/register 提示时自动用 `config.password`
- 翻译表 `lib/data/zh_cn.json` 为官方 mcmeta 1.20.4（6538 键）；`blockIdFromZh` 反查中文方块名；`translateBlock/translateEntity` 查不到时做归一化反查（忽略空格/连字符，支持显示名如 `Oak Sign`）
- 物品名匹配：`dropItem/getItemCount/placeBlock` 支持中文名、带空格显示名、引号（`丢 "Oak Sign" 1`）、连字符
- 被动感知只跟踪 8 格内实体，物品实体已过滤（防刷屏）
- 日志写入 `chat_YYYY-MM-DD.log`（已 gitignore）
- 无测试套件：改动后用 `node --check <file>` 验证语法；地图/渲染逻辑可写临时假 bot 脚本验证，功能需连真实服务器验证
- Windows 下中文乱码时运行 `chcp 65001`
- TUI 顶部三栏 HUD：左状态 / 中 11×11 小地图 / 右感知通知；地图用 **256 色背景**（`48;5`，conhost 不支持 truecolor `48;2`），每列从世界顶（`bot.game.minY+height`）往下扫最表层方块上色；PgUp/PgDn 滚动历史；SGR 鼠标序列已过滤；鼠标协议（?1000h/?1006h）曾引发输入错乱已回退，勿轻易重开
- 小地图每帧最多 384 层 × 121 格 blockAt 采样，若 TUI 卡顿先优化 `topColor` 扫描起点，勿直接加依赖（`@aresrpg/aresrpg-map-colors` 因依赖 `cwise` 需 git+ssh 装不上）
