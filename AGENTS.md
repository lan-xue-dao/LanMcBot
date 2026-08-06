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
  minimap.mjs      # 小地图（MCC 算法：▀半块双色、浮雕明暗、洞穴模式）
  config.mjs / logger.mjs
  nav/             # 自研避障移动引擎（完全替代 mineflayer-pathfinder）
    world.mjs      #   世界采样/方块分类（名字驱动）/列地面扫描/可走性
    line.mjs       #   直线走廊检测（DDA 逐格验证，返回阻挡格）
    detour.mjs     #   最小偏差绕障（列式 A*，窗口 8→40 递增）
    smooth.mjs     #   橡皮筋平滑（隔点直线回连剪枝）
    controller.mjs #   直线执行器（面向路点/点跳/卡住重规划/事件）
    index.mjs      #   统一出口 initNav(bot, onEvent) → {goto, stop, isMoving, destroy}
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
- **自研避障引擎（lib/nav/，完全替代 mineflayer-pathfinder）**：`moveTo` 走「直线优先 → 被挡转最小偏差绕行 → 橡皮筋平滑」。`checkLine`（line.mjs）用 DDA 逐格验证走廊（地面可达 + 身体可穿过 + 斜向邻格检查），被挡时 `findDetour`（detour.mjs）在「距直线窗口 W=8→+4→40」的列式 A* 里搜偏差最小路径（代价 = 步数 + λ·偏差²），吹回直线；`smoothPath`（smooth.mjs）反复隔点直线回连剪枝；controller 沿路点行走，台阶/矮墙用碰撞触点点跳（无物理模拟），卡住 3s 原地重规划（递增退避后上报 path_failed），超长直线（默认 96 格）截断后走完续算（增量推进）。v1 不挖不搭（对应 canDig=false / allow1by1towers=false）
- **地面站立的坑**：`groundAt` 把门的顶面排除（门/栅栏门 standable=false），否则会 「从门顶跳过去」；关闭的非铁门在 detour 里标记 needsOpen（门体上下两格都算），controller 靠近时 `activateBlock`，铁门视为墙
- **`lineCells` DDA 已修过边界 bug**：起点恰在格子边界向负方向时 `tMax=0`，平局双双步进会过冲死循环（加 100k guard 防御）；改单轴步进 + 真平局才斜向
- **寻路事件**：nav 引擎直接 emit `move_started` / `path_update{status}` / `path_failed{status}` / `goal_reached`（controller 里状态去重，避免刷屏）；cli/tui 照旧消费
- `path_update` 上报节流：同状态不重复；`goal_reached` 到达即发（无防抖）
- 自动重连：断开后 5 秒重试，最多 3 次；重连后 3 秒自动补发 `/server <原服务器>` 回服
- 自动登录：`messagestr` 检测到 login/register 提示时自动用 `config.password`
- 翻译表 `lib/data/zh_cn.json` 为官方 mcmeta 1.20.4（6538 键）；`blockIdFromZh` 反查中文方块名；`translateBlock/translateEntity` 查不到时做归一化反查（忽略空格/连字符，支持显示名如 `Oak Sign`）
- 物品名匹配：`dropItem/getItemCount/placeBlock` 支持中文名、带空格显示名、引号（`丢 "Oak Sign" 1`）、连字符
- 被动感知只跟踪 8 格内实体，物品实体已过滤（防刷屏）
- 日志写入 `chat_YYYY-MM-DD.log`（已 gitignore）
- 无测试套件：改动后用 `node --check <file>` 验证语法；地图/渲染逻辑可写临时假 bot 脚本验证，功能需连真实服务器验证
- Windows 下中文乱码时运行 `chcp 65001`
- TUI 顶部三栏 HUD：左状态 / 中 11×11 小地图 / 右感知通知；地图用 **256 色背景**（`48;5`，conhost 不支持 truecolor `48;2`）；PgUp/PgDn 滚动历史；SGR 鼠标序列已过滤；鼠标协议（?1000h/?1006h）曾引发输入错乱已回退，勿轻易重开
- 小地图照搬 **MCC（Minecraft Console Client）** 算法（lib/minimap.mjs）：每个终端格 = `▀` 半块 + fg/bg 双色（纵向 2 像素/格，22 像素高）；配色用官方 MapColor 表 `lib/data/minimap_block_colors.json`（MCC 仓库生成，PascalCase 键 → snake_case 匹配 mineflayer 方块名，`grass_block` 等键形如 `GrassBlock`）；地表模式从 `playerY+32` 往下扫首个非透明方块（非全高度），水面按深度混蓝（≤0.85）、冰叠色、玻璃/空气穿透；按**北邻高度差**做 220/255/180 浮雕明暗；洞穴模式（下界或头顶 32 格内有实心方块自动开启）从玩家 Y 找洞穴地板并压暗 0.55、非洞穴像素描边 16,16,16；实体按类别涂色（敌对红/被动绿/中立橙/玩家白）、深度 >5 渐淡 >15 不显示、同格高优先级覆盖；`lib/data/minimap_entity_categories.json` 实体分类同源
- 小地图数据 JSON 是 UTF-8 **带 BOM**（PowerShell Out-File 生成），`loadJson` 里已剥 BOM；如重新生成数据文件注意这一点
- **`bot.blockAt` 只接受真 Vec3 实例**（prismarine-world 会调 `pos.floored()`）：传纯 `{x,y,z}` 对象会抛 `TypeError: pos.floored is not a function`，传三个数字会静默返回 null——全库调用点（lib/minimap.mjs、lib/nav/world.mjs、lib/bot.mjs、perception/*）统一用 `vec3(...)` 或 `pos.offset()`，勿用三参数/裸对象形式
