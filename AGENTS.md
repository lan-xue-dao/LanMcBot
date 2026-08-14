# mcbot

Minecraft 机器人（mineflayer），双模式界面：全屏 TUI / 纯 CLI，模块化架构，ESM 与 CommonJS 混合。

## 运行 / Run

```bash
npm start            # 入口 index.js → 按 config.ui 加载 cli.mjs 或 tui.mjs
npm run mcp          # MCP 服务器 (stdio)
npm run mcp:sse      # MCP 服务器 (SSE)
npm run mcp:stdio    # MCP 服务器 (stdio)
node setup-security.mjs  # 安全初始化（可选，密码加密）
```

双模式切换：`node index.js --tui` / `--cli` 覆盖 `config.json` 的 `"ui": "cli"|"tui"`。

## 配置 / Config

### 环境变量配置（推荐）

使用 `.env` 文件或环境变量配置（覆盖 `config.json`）：

```bash
# 服务器配置
MCBOT_HOST=your-server.com
MCBOT_PORT=25565
MCBOT_USERNAME=LanBot

# 认证配置
MCBOT_AUTH=offline
MCBOT_PASSWORD=your-password

# 安全密钥（用于加密 password.enc）
MCBOT_PASSWORD_KEY=your-32-byte-hex-key

# UI 模式
MCBOT_UI=cli  # 或 tui
```

### 配置文件

- `.env` - 环境变量配置（建议使用，**不提交到 Git**）
- `.env.example` - 配置示例（复制为 `.env` 修改使用）
- `password.enc` - 加密的密码文件（**不提交到 Git**）

**安全性**：
- 密码支持环境变量或加密文件
- 优先级：环境变量 > 加密文件 > `config.json`（向后兼容）
- `.gitignore` 已配置，敏感文件不会被提交

## 项目结构 / Structure

```
index.js           # 入口，动态 import() 加载 cli.mjs 或 tui.mjs
cli.mjs            # 纯 CLI 模式（readline）
tui.mjs            # 全屏 TUI 模式（自研 ANSI 重绘，非 ink）
mcp-server.mjs     # MCP 服务器（全局单例实例）
lib/
  bot.mjs          # 核心：连接/重连/寻路/聊天指令（sendChat 统一出口，emit bot_chat）
  commands.mjs     # CLI 命令（!前缀；restart 优化为 1s 延迟+超时保护）
  i18n.mjs         # 中文翻译（lib/data/zh_cn.json）
  minimap.mjs      # 小地图（MCC 算法）
  logger.mjs       # 日志分离：chat_*.log / bot_*.log
  config.mjs       # 配置加载：环境变量 > 加密文件 > config.json
  nav/             # 自研移动引擎（完全替代 mineflayer-pathfinder）
    plan.mjs       #   规划器：先直线 DDA、被挡转 A* 演化 + walkable 单格判定
    controller.mjs #   执行器：沿路点直行、门交互、路线失效停下重算
    world.mjs      #   世界采样/方块分类（名字驱动）/groundAt 列扫描
                     #   自动缓存清理（1分钟）防止内存泄漏
    index.mjs      #   出口 initNav(bot,onEvent) → {goto,stop,isMoving,destroy}
    line.mjs / detour.mjs / smooth.mjs  # 遗留：预规划时代，已不引用（待删）
  perception/
    index.mjs           # 感知统一导出（scan + monitor + environment）
    active/scan.mjs     # 主动感知（命令触发，16×16×16，radius 8）
    passive/monitor.mjs # 被动监听（受伤/攻击/实体接近，过滤物品实体）
index.d.ts             # TypeScript 类型定义（IDE 自动补全支持）
tests/                 # 测试套件
  utils.test.mjs       # 单元测试（29 个测试用例）
```

## 命令 / Commands

### CLI 命令（`!` 或全角 `！` 均支持）

- 移动：`!f/前` `!b/后` `!l/左` `!r/右` `!jump` `!sneak` `!stop` `!move <x> <y> <z>`（寻路）
- 动作：`!attack` `!use` `!sleep` `!wake`
- 感知：`!scan` `!players` `!entities` `!blocks` `!find <方块名>`（支持中文名）`!danger`
- 背包：`!inv` `!count <物品>` `!place <方块> <x> <y> <z> [px py pz]`（可选站位，返回 Promise）
- 系统：`!help` `!exit/!quit` `!restart` `!connect` `!reconnect` `!mcp` `!mcp-stdio` `!mcp-sse`

**注意**：
- `!place` 现在返回 Promise，支持 `await` 或 `.then/.catch`
- `!sleep` 现在返回 Promise，支持 `await` 或 `.then/.catch`

### 聊天指令（唤醒词触发）

格式：`LanBot <cmd>`，唤醒词忽略大小写但**必须完整匹配 lanbot**（`lan` 不触发）。

- 支持：`help`、`move <x> <y> <z>`、`sleep`、`wake`、`attack`、`丢 <物> [数量]`、`背包`、`数量 <物>`、`place <方块> <x> <y> <z> [px py pz]`
- 不带唤醒词时 `丢`/`背包`/`数量` 仍可用；未知唤醒指令回复「未知指令」
- 聊天帮助是**单条消息**，用 `\n` 换行，格式与 `!help` 一致
- 任意玩家发 `hello` 会自动回复「你好 <玩家>！」

## MCP 服务器 / MCP Server

### 工具列表

- `send_chat` - 发送聊天消息
- `get_status` - 获取机器人状态（connected/username/health/food/position）
- `get_players` - 获取在线玩家列表
- `get_position` - 获取机器人位置
- `get_inventory` - 获取背包物品
- `connect` - 连接服务器
- `disconnect` - 断开连接

### 特性

- **全局单例**：所有工具共享一个 bot 实例，避免资源浪费
- **优雅关闭**：支持 SIGINT/SIGTERM 信号
- **错误处理**：所有错误都会记录到控制台并返回错误信息
- **实时反馈**：MCP 事件会打印到 stderr

### 传输模式

- `npm run mcp` - stdio 模式（默认）
- `npm run mcp:sse` - SSE 模式
- `npm run mcp:stdio` - 显式指定 stdio

**注意**：切换传输模式时需要重启 MCP 服务器。

## 导航引擎 / Nav

**先规划、后执行**：`goto` 立即调 `planRoute`（plan.mjs）——先试直线 DDA，被挡则 A* 演化出「途径无障碍且最短」的路点队列 `{x,y,z,action}`；controller 逐路点直行。**路线途中失效（当前路点不可走/视线前方新障碍）→ 障碍前停下重算**，循环直到到达或总超时 600s。

- **walkable**（plan.mjs 与 controller 共用判定）：高度差 `[-4, +1.2]` 走/落/跳；悬空（脚下格无 standable）不判障碍交给重力
- **穿透方块**（`isPenetrableName`，world.mjs）：木门、活板门、压力板、按钮、告示牌不挡身体；铁门算墙
- **门**：关着的门 `action:'open'` — controller 在 `horiz<1.2`（不必到格心）就停下 `activateBlock` 开门，等 `_properties.open` 变 true 后 `doorpass` 偏移 0.2-0.5 格穿过；开着的门 `action:'door'` 同样偏移穿过。`doorOpen()` 读 `world.getCell(x,y,z).open`
- **地面站立的坑**：`groundAt` 排除门的顶面（门 standable=false），否则会「从门顶跳过去」；开着的活挡门也不可站
- **二次 goto**：必须完整重置 `waitingOpen/mode/passSide/passUntil/replanAt` + `clearControls()`，否则旧门的等待/穿门状态与新目标互搏
- **到达判据**：xz 距路点格心 ≤0.6 且 y 差 ≤1.2；路点最后一个 = 终点
- **寻路事件**（兼容旧 pathfinder）：`move_started` / `path_update{status}`（同状态去重）/ `path_failed{status}` / `goal_reached`
- **A* 坑**：`open` 集节点必须自带 `g`（曾从外部 `gScore` 读导致 f=NaN 选不出节点），勿回归

## 日志 / Logs

- `chat_YYYY-MM-DD.log` — 聊天记录（收：`chat`/`messagestr` 事件；发：`bot.mjs` sendChat → `bot_chat` 事件）。**发消息统一走 `sendChat(text)`，勿直接 `bot.chat()`**，否则不进记录；UI 层勿再手动补记（会双写）
- `bot_YYYY-MM-DD.log` — 本体运行（连接/重连/导航/感知/错误/命令反馈，`logRaw`/`log`）
- `chatLog(msg)` 只写文件不打印；`log()/logRaw()` 由 UI 层 `addMessage()` 打印
- 均已 gitignore

## 验证 / Verify

- 无测试套件：改动后 `node --check <file>`
- `plan.mjs`/`world.mjs` 可用临时脚本 + 假世界（`{name,shapes,_properties}`）纯逻辑验证 `walkable`/`planRoute`；**Windows 上 node 默认堆易 OOM，用 `node --max-old-space-space=1024` 或 `--max-old-space-size=768`**
- 实机功能需连真实服务器验证

## 平台 / Platform

- `package.json` 是 `"type": "commonjs"`，界面/库文件用 `.mjs` ESM，`index.js` 动态 `import()`；新增文件注意扩展名
- **`bot.blockAt` 只接受真 Vec3 实例**（内部调 `pos.floored()`）：纯对象抛 TypeError、传三个数字静默返回 null —— 全库统一 `vec3(...)` 或 `pos.offset()`，勿用三参数/裸对象
- Windows 中文乱码：`chcp 65001`
- TUI 顶部三栏 HUD：左状态 / 中 22×11 小地图（每格 `▀` 纵向 2 像素，横向 1 格=1 方块）/ 右感知通知；地图用 256 色背景（`48;5`，conhost 不支持 truecolor `48;2`）；鼠标协议（?1000h）曾引发输入错乱已回退，勿重开
- 自动重连：断开 5s 重试（最多 3 次）；重连后 3s 自动补发 `/server <原服务器>` 回服；`messagestr` 检测 login/register 时自动用 `config.password`
- 小地图数据 JSON 是 UTF-8 **带 BOM**（PowerShell Out-File 生成），`loadJson` 已剥 BOM；重新生成数据注意
- 翻译表 `lib/data/zh_cn.json`（mcmeta 1.20.4）；物品名匹配支持中文名/带空格显示名/引号/连字符

## 修复记录（重要）

- **restart 只退出不重启**：曾经 spawn 后立即 `exit()`，子进程句柄易夭折。改为 spawn（`process.execPath`+`argv.slice(1)`，`detached/inherit`）+ 等 `spawn` 事件 + 250ms 延迟再 `exit()`（commands.mjs）
- **门被当墙**：早期 controller 只在到达门格中心（0.6）才开门，门体堵死永远到不了中心 → 改为 `horiz<1.2` 提前开门
- **模拟器（测试假 bot）**：`jump` 需在位移之后再减重力，否则每次跳跃被吞；跳高初始 `vel.y=1.4` 才能过 1 格台阶