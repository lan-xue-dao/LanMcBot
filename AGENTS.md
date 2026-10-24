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

`.env` 文件或真实环境变量，覆盖 `config.json`：

```bash
MCBOT_HOST=your-server.com
MCBOT_PORT=25565
MCBOT_USERNAME=LanBot
MCBOT_AUTH=offline
MCBOT_PASSWORD=            # 留空！填了会盖掉加密文件
MCBOT_PASSWORD_KEY=<64位hex>  # 解密 password.enc 用
MCBOT_UI=cli               # 或 tui
```

### 配置文件

- `.env` — 环境变量配置（**不提交**）
- `.env.example` — 配置示例
- `password.enc` — 加密密码（**不提交**）

**密码优先级**：`MCBOT_PASSWORD`（明文）> `password.enc`（解密）> `config.json`（已删该字段，仅兼容）

- `config.mjs` **自带极简 .env 解析器**（不依赖 dotenv）：只认 `KEY=VALUE`，忽略空行与 `#` 注释，不做变量展开；真实环境变量优先于 `.env`
- `.env` 的 `MCBOT_PASSWORD` **必须留空**，否则明文覆盖加密文件，加密形同虚设
- `config.json` 已移除 `password` 字段，**勿加回**

**加密约定（两侧必须一致，勿单改）**：
- `password.enc` 格式 `<iv-hex>:<ciphertext-hex>`，**纯 hex 文本**
- `MCBOT_PASSWORD_KEY` 为 32 字节（64 位 hex），**直接作 AES-256-CBC 密钥，不再 SHA 派生**
- IV 独立随机 16 字节，与密文同存（勿从密钥切片取 IV）
- `setup-security.mjs` 加密后**立即自检**解回比对，不符即 `exit(1)`
- 换机器需重跑 `node setup-security.mjs`；密钥丢失只能重新初始化

## 项目结构 / Structure

```
index.js           # 入口，动态 import() 加载 cli.mjs 或 tui.mjs
cli.mjs            # 纯 CLI 模式（readline）
tui.mjs            # 全屏 TUI 模式（自研 ANSI 重绘，非 ink）
mcp-server.mjs     # MCP 服务器（全局单例实例）
lib/
  bot.mjs          # 核心：连接/重连/寻路/聊天指令（sendChat 统一出口，emit bot_chat）
  lifecycle.mjs    #   可单测纯逻辑：自动重生(createDeathHandler) + 重连判定(shouldReconnect)
  combat.mjs       #   战斗（P0-2）：可单测纯逻辑 + 注入式 controller；不引第三方 pvp（硬绑已删 pathfinder）
  entities.mjs     #   实体分类单一数据源：统一敌对生物表 HOSTILE_MOBS + isHostile()
  craft.mjs        #   合成（P0-4）：零依赖纯逻辑（canCraft/ingredientsNeeded/matchCraftableByName）
  survival.mjs     #   自动进食（P0-4）：食物表/选食纯逻辑 + 注入式 controller（副手进食，默认开启）
  mining.mjs       #   挖掘（P0-3）：选目标/选工具纯逻辑（pickMineTarget/pickBestTool/nextAction）
  containers.mjs   #   容器（P1）：箱子/木桶存取规划纯逻辑（planDeposit/planWithdraw/pickNearestContainer）
  triggers.mjs     #   触发引擎（P1）：when/match 规则解析与匹配纯逻辑 + 引擎（!rule 管理，事件: chat/death/health/join/leave；规则持久化到 rules.json，启动自动恢复）
  build.mjs        #   建造蓝图（P0-3 建造侧）：模板展开纯函数（generateBlueprint 墙/地板/空心盒/立柱 + checkBlueprint 上限 512）
  smelt.mjs        #   熔炉烧炼（P1 合成域）：燃料表 fuelTicks / pickFuel / nextFurnaceAction 纯逻辑（零 bot 依赖可单测）
  follow.mjs       #   跟随（P1）：findPlayerByName/decideFollow 纯函数 + 注入式 controller（默认关；combat 占用时 isBusy 让出 nav）
  trade.mjs        #   村民交易（P1）：formatTrades/canAfford/pickBestTrade 纯逻辑（归一化/可支付判定/最佳选单，零 bot 依赖可单测）
  enchant.mjs      #   附魔台（P1）：formatEnchantOptions/enchantOptionsReady/pickEnchantOption 纯逻辑（选档/就绪判定/经验校验，零 bot 依赖可单测）
  farming.mjs      #   耕种收获（P1）：CROPS 表 + isRipe/selectRipeCrops/replantSeed 纯逻辑（成熟判定/补种映射，零 bot 依赖可单测）
  inventory.mjs    #   背包整理（P1）：planStackMerge（同类散堆合并规划）+ countFragments（碎片统计），零 bot 依赖可单测
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
                     #   旧 line.mjs/detour.mjs/smooth.mjs 已删除（提交 34938af，无引用）
  perception/
    index.mjs           # 感知统一导出（scan + monitor）
    active/scan.mjs     # 主动感知（命令触发，16×16×16，radius 8）
    threat.mjs          #   感知增强：formatEntity（血量/朝向/手持/着地）+ threatScore/rankThreats（距离加权，零 bot 依赖可单测）
    passive/monitor.mjs # 被动监听（受伤/攻击/实体接近，过滤物品实体）
index.d.ts             # TypeScript 类型定义（IDE 自动补全支持，package.json 已声明 types）
setup-security.mjs     # 密码加密初始化（生成密钥 + password.enc + .env，含自检）
tests/
  utils.test.mjs       # 单元测试（mocha，已装进 devDependencies）
```

### 文档产物

`CODE_REVIEW.md`（评审 6.1/10）、`FIXES.md`（分阶段修复计划）、`REVIEW_SUMMARY.md`、`FIXES_APPLIED.md`、`NAV_FIXES.md` 均为历史评审/修复记录，非运行所需。

## 命令 / Commands

### CLI 命令（`!` 或全角 `！` 均支持）

- 移动：`!f/前` `!b/后` `!l/左` `!r/右` `!jump` `!sneak` `!stop` `!move <x> <y> <z>`（寻路）
- 动作：`!attack` `!use` `!sleep` `!wake`
- 战斗：`!combat`（开启自动战斗：持续攻击 + 受击反击 + 低血量撤退）`!combat-off`（关闭）`!pvp`/`!pvp-off`（PvP 开关，默认关；开启后玩家按距离参与索敌）`!aggro nearest|threat`（索敌模式，默认 nearest 行为同旧；threat 按威胁分加权接入 perception/threat 单一数据源）
- 感知：`!scan` `!players` `!entities` `!blocks` `!find <方块名>`（支持中文名）`!danger` `!threat`（距离加权威胁排序：血量/朝向/手持）
- 挖掘：`!mine <方块名> [数量]`（自动走近/换工具/挖，24 格范围）
- 建造：`!build <wall|floor|box|pillar|墙|地板|盒子|柱子> <方块名> <x1 y1 z1 x2 y2 z2>`（蓝图批量放置，上限 512 格，失败格跳过）
- 容器：`!chest 存 [保留物品名...]`（存入最近箱子/木桶，默认保留工具/武器/食物）`!chest 取 <物品> [数量]`
- 背包：`!inv` `!tidy`（一键整理，合并同类散堆）`!count <物品>` `!place <方块> <x> <y> <z> [px py pz]`（可选站位）
- 合成：`!recipes <物品>`（查配方与缺口）`!craft <物品> [数量]`（合成）`!gear`（自动装备最佳武器/护甲）`!smelt <物品> [数量]`（熔炉烧炼，自动补料/燃料/取产出）
- 附魔：`!enchant <物品> [次数] [省]`（附魔台，需附近有台子/青金石/经验；默认最高档，加「省」选最低档）
- 耕种：`!harvest`（收获附近成熟作物并尽力补种：麦/胡萝卜/土豆/甜菜/可可/下界疣/浆果）
- 生存：`!eat`（开启自动进食，默认开启）`!eat-off`（关闭）
- 跟随：`!follow <玩家名>`（跟随视野内玩家，>5m 自动 nav 靠近；默认关，战斗开启时自动让权）`!follow-off`（关闭）；裸 `!follow` 显示当前目标/用法
- 交易：`!trade`（看最近村民报价）`!trade <物品> [数量]`（自动走近/选最佳可支付交易/下单，支持中文名）
- 触发：`!rule add "when <事件> <匹配式> then <动作> [参数]"` `!rule list` `!rule del <序号>`（事件: chat/death/health/join/leave；匹配: /正则/ contains: exact: *；动作: say <文本> 或触发 trigger_action 事件）
- 系统：`!help` `!exit/!quit` `!restart` `!connect` `!reconnect` `!mcp` `!mcp-stdio` `!mcp-sse`

**已修复（Promise 调用点）**：`bot.placeBlock()` 与 `bot.sleep()` 返回 Promise，调用点一律 `.then/.catch` 回填消息，勿再按同步值判断（`!result.ok` 恒真、`result === 'sleeping'` 恒假）。`handleCommand` 保持同步返回 boolean，因 cli/tui 的 `if (!handled)` 依赖它 fallback 到聊天。
- 修过的 4 处：`commands.mjs` 的 `!place`/`!sleep`，`bot.mjs` 聊天指令的 `place`/`sleep`
- `bot.sleep()` 未连接分支返回 `Promise.reject(new Error('未连接'))`（曾是 `return false`，`.catch` 会 TypeError）

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
- `tidy_inventory` - 一键整理背包（合并同类散堆，仅主背包）
- `get_recipes` - 查询合成配方与材料缺口
- `craft_item` - 合成物品（自动匹配配方与材料检查）
- `equip_gear` - 自动装备最佳武器与护甲
- `attack_nearest` - 攻击最近的敌对生物
- `mine_block` - 挖掘指定方块（自动走近/换工具）
- `build_blueprint` - 蓝图批量建造（墙/地板/空心盒/立柱，两角点，上限 512 格）
- `smelt_item` - 熔炉烧炼（自动补原料/燃料并取回产出）
- `enchant_item` - 附魔台附魔（自动走近/择优档，需附魔台/青金石/经验）
- `harvest_crops` - 收获附近成熟作物并尽力补种（麦/胡萝卜/土豆/甜菜/可可/下界疣/浆果）
- `list_trades` - 查看最近村民交易报价（归一化，含售罄/剩余次数）
- `trade_with` - 与最近村民交易指定产物（自动走近/选最佳可支付交易，支持中英文名）
- `threat_report` - 威胁排序（血量/朝向/手持/距离加权评分，降序）
- `chest_deposit` - 存背包物品入最近容器（可选 keep 保留名单）
- `chest_withdraw` - 从最近容器取出物品
- `move_to` - 寻路移动到指定坐标（自研 nav）
- `stop_move` - 停止移动
- `follow_player` - 跟随指定玩家（name 必填，需视野内；nav 靠近，combat 开启时让权）
- `unfollow` - 停止跟随（同时清掉跟随驱动的导航移动）
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

**实现要点**：`globalBot` / `globalNav` / `mcpStarted` 为模块级单例，`ensureBot()` 懒创建并把事件打到 `console.error`（stdio 模式下 stdout 归协议专用，**日志绝不能写 stdout**）。`send_chat`/`connect` 用 `ensureBot()`；`get_status`/`get_players`/`get_position`/`get_inventory` 用 `getBot()`，未连接返回 `isError: true`；`disconnect` 仅在 `globalBot` 存在时调 `destroyBot()`。

## 导航引擎 / Nav

**先规划、后执行**：`goto` 立即调 `planRoute`（plan.mjs）——先试直线 DDA，被挡则 A* 演化出「途径无障碍且最短」的路点队列 `{x,y,z,action}`；controller 逐路点直行。**路线途中失效（当前路点不可走/视线前方新障碍）→ 障碍前停下重算**，循环直到到达或总超时 600s。

- **walkable**（plan.mjs 与 controller 共用判定）：高度差 `[-4, +1.2]` 走/落/跳；悬空（脚下格无 standable）不判障碍交给重力
- **穿透方块**（`isPenetrableName`，world.mjs）：木门、活板门、压力板、按钮、告示牌不挡身体；铁门算墙
- **门**：关着的门 `action:'open'` — controller 在 `horiz<1.2`（不必到格心）就停下 `activateBlock` 开门，等 `_properties.open` 变 true 后 `doorpass` 偏移 0.2-0.5 格穿过；开着的门 `action:'door'` 同样偏移穿过。`doorOpen()` 读 `world.getCell(x,y,z).open`。开门最多重试 `OPEN_MAX_ATTEMPTS=3` 次，超限才重算路径（避免门打不开时死等）
- **地面站立的坑**：`groundAt` 排除门的顶面（门 standable=false），否则会「从门顶跳过去」；开着的活挡门也不可站
- **`groundAt` 是双向扫描**：先向上找 1 格（处理悬空上方有站立面），再向下扫到 `toY`
- **二次 goto**：必须完整重置 `waitingOpen/mode/passSide/passUntil/replanAt/openAttemptCount` + `clearControls()`，否则旧门的等待/穿门状态与新目标互搏
- **到达判据**：xz 距路点格心 ≤0.6 且 y 差 ≤1.2；路点最后一个 = 终点
- **卡住检测用 3D 距离**（含 y）：3s 内移动 <0.3 格才算卡住；穿门卡→换侧，直行卡→点跳（≤3 次），再卡→重算
- **寻路事件**（兼容旧 pathfinder）：`move_started` / `path_update{status}`（同状态去重）/ `path_failed{status}` / `goal_reached`
- **A* 坑**：`open` 集节点必须自带 `g`（曾从外部 `gScore` 读导致 f=NaN 选不出节点），勿回归

### A* 代价权重（plan.mjs）

| 常量 | 值 | 含义 |
|---|---|---|
| `STEP_COST` | 1 | 直行一格 |
| `DIAG_COST` | 1.414 | 斜行一格 |
| `RISE_COST` | 0.8 | 每上升 1 格额外代价 |
| `OPEN_COST` | 1.0 | 经过需开门的格子 |

权衡意图：**优先开门 > 绕路 > 爬楼梯**。曾设 `OPEN_COST=2` / `RISE_COST=0.5`，导致开门比爬楼梯还贵、规划器宁愿绕远路，已调反。

### 已知待优化项（未修）

（无）

### 已优化项

- **A* 惰性 decrease-key**（提交 `e0118db`）：发现更优 g 时更新 `gScore` 权威值并允许重复入堆，pop 出 g 与权威值不一致的陈旧条目直接跳过；closed 集仍防重复展开。修复了旧实现「已入 open 的节点无法改进 g」在非均匀边权（RISE/OPEN_COST）下的次优路径问题。**勿回归**：入堆条件是 `cost < gScore.get(nk)`，不要再加 `openKeys.has(nk) continue`
- **坐标键防碰撞**：`key=(x,z)=>x*65536+z` 改为字符串键 `` `${x},${z}` ``（旧键在 |坐标差|≥65536 时碰撞）
- **`open` 集取最小 f 已从线性扫描改为二叉堆**（`plan.mjs` 的 `MinHeap`，平局按入堆序 `seq` 比较，完全复刻旧 Map 先入优先语义）：整体由 O(n²) 降到 O(n log n)，路径产出行为不变（9 组对照测试全匹配）。`openKeys` Set 保留 `has` 判断。

### 关于替换为第三方引擎

调研过 `@miner-org/mineflayer-baritone`（4.5.1，ISC，peer mineflayer ^4.35.0，与本项目兼容）。它有 parkour / 挖放方块 / 游泳 / 爬梯，但 **README 完全未提门交互**，且自述 parkour 复杂序列会卡、出水需多次尝试。**门逻辑是本项目的硬约束**，直接替换会丢失。结论：如要引入，应作为**可选后端**并行（`initNav(bot, onEvent, backend)` + `MCBOT_NAV` 切换），而非替换自研实现。

`baritone-ts` 在 npm 上不存在（404）。

`mineflayer-pathfinder ^2.4.5` 死依赖已在提交 `34938af` 删除（nav 已完全替代，无引用）。

## 日志 / Logs

- `chat_YYYY-MM-DD.log` — 聊天记录（收：`chat`/`messagestr` 事件；发：`bot.mjs` sendChat → `bot_chat` 事件）。**发消息统一走 `sendChat(text)`，勿直接 `bot.chat()`**，否则不进记录；UI 层勿再手动补记（会双写）
- `bot_YYYY-MM-DD.log` — 本体运行（连接/重连/导航/感知/错误/命令反馈，`logRaw`/`log`）
- `chatLog(msg)` 只写文件不打印；`log()/logRaw()` 由 UI 层 `addMessage()` 打印
- 均已 gitignore

## 验证 / Verify

- 改动后 `node --check <file>`（最低要求）
- `npm run verify` = `node --check index.js && node --check lib/**/*.mjs`
- `tests/utils.test.mjs` 用 mocha，已装进 `devDependencies`；`npm test` 可正常跑
- `plan.mjs`/`world.mjs` 可用临时脚本 + 假世界（`{name,shapes,_properties}`）纯逻辑验证 `walkable`/`planRoute`；**Windows 上 node 默认堆易 OOM，用 `--max-old-space-size=768` 或 `1024`**
- 配置/加密改动：`node setup-security.mjs` 自带自检；另可 `node -e "import('./lib/config.mjs').then(m=>console.log(m.default.password.length))"` 确认密码解出
- 实机功能需连真实服务器验证
- **临时验证脚本用完即删**（曾遗留 `test-encrypt.mjs`/`test-config.mjs`/`restart-child-marker.txt`）

## 平台 / Platform

- `package.json` 是 `"type": "commonjs"`，界面/库文件用 `.mjs` ESM，`index.js` 动态 `import()`；新增文件注意扩展名
- `.mjs` 里**没有 `require`**：需要时用 `createRequire(import.meta.url)`（`lib/config.mjs` 读 `config.json` 即如此），或改 `import()`
- **Node v24 无 `crypto.createCipher`/`createDecipher`**（已移除），只能用 `createCipheriv`/`createDecipheriv`
- **二进制 Buffer 绝不能以 `'utf8'` 写文件**：`writeFileSync(f, buf, 'utf8')` 会把非法字节替换成 U+FFFD 而永久损坏数据（曾致密文解不开）。密文一律转 hex/base64 文本再写
- **`bot.blockAt` 只接受真 Vec3 实例**（内部调 `pos.floored()`）：纯对象抛 TypeError、传三个数字静默返回 null —— 全库统一 `vec3(...)` 或 `pos.offset()`，勿用三参数/裸对象
- Windows 中文乱码：`chcp 65001`
- PowerShell 下 **`git commit -m "$(cat <<'EOF' ...)"` 这类 heredoc 不可用**（`<<` 被当重定向符），多行提交信息改用 `-F` 读文件或单行
- npm 全局缓存曾因权限报 `EPERM`（`C:\Users\...\npm-cache`），可临时 `--cache <工作区目录>` 绕过，**用完删掉临时缓存目录**
- TUI 顶部三栏 HUD：左状态 / 中 22×11 小地图（每格 `▀` 纵向 2 像素，横向 1 格=1 方块）/ 右感知通知；地图用 256 色背景（`48;5`，conhost 不支持 truecolor `48;2`）；鼠标协议（?1000h）曾引发输入错乱已回退，勿重开
- 自动重连：断开 5s 重试（最多 3 次）；重连后 3s 自动补发 `/server <原服务器>` 回服；`messagestr` 检测 login/register 时自动用 `config.password`
- 小地图数据 JSON 是 UTF-8 **带 BOM**（PowerShell Out-File 生成），`loadJson` 已剥 BOM；重新生成数据注意
- 翻译表 `lib/data/zh_cn.json`（mcmeta 1.20.4）；物品名匹配支持中文名/带空格显示名/引号/连字符

## 修复记录（重要）

- **restart 只退出不重启**：曾经 spawn 后立即 `exit()`，子进程句柄易夭折。改为 spawn（`process.execPath`+`argv.slice(1)`，`detached/inherit/windowsHide`）+ 等 `spawn` 事件 + **1000ms** 延迟再 `exit()`，并加 `spawnSuccess` 标志（`error` 仅在未 spawn 时报错）与 5000ms 超时兜底（commands.mjs）
- **门被当墙**：早期 controller 只在到达门格中心（0.6）才开门，门体堵死永远到不了中心 → 改为 `horiz<1.2` 提前开门
- **模拟器（测试假 bot）**：`jump` 需在位移之后再减重力，否则每次跳跃被吞；跳高初始 `vel.y=1.4` 才能过 1 格台阶
- **AES 密钥长度 + 密文损坏（两个叠加 bug）**：`aes-256-cbc` 需 32 字节密钥，但曾把 SHA-256 结果切成 `slice(0,16)` 作 IV、`slice(16)` 作密钥 → 密钥仅 16 字节，报 `ERR_CRYPTO_INVALID_KEYLEN`；改用完整 32 字节后又因密文以 `'utf8'` 落盘被 U+FFFD 污染，报 `ERR_OSSL_BAD_DECRYPT`。最终方案见「加密约定」
- **MCP 每次工具调用都新建 bot**：改为模块级 `globalBot` + `ensureBot()` 单例，`SIGINT`/`SIGTERM` 走 `mcpShutdown()`；未连接的查询类工具返回 `isError: true`
- **nav world 缓存无界增长**：`createWorld(blockAtFn, minY, worldSize=96)` 每 60s `cleanupCache()`，删除 `Math.hypot(cx,cz) > worldSize/2` 的键；`clearCache()` 同时清定时器；新增 `getCacheSize()`
- **`quitBot()` 已真正 await 断连**（提交 `d587864`）：内部 `await waitForDisconnect()`（轮询 100ms 等 `bot`/`bot._client` 消失，最多 3s）再置 null；`destroyBot()` 与 `reconnect()` 已改 `async` 并 `await quitBot()`，`reconnect` 先置 `intentionalQuit` 防旧 bot 的 `end` 事件误触发自动重连