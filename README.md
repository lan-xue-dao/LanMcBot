# mcbot

基于 [mineflayer](https://github.com/PrismarineJS/mineflayer) 的 Minecraft 机器人，目标是与 Minecraft 客户端（MCC）能力相当：连接/自动重连/自动重生、移动寻路、战斗（PvE/PvP）、建造与挖掘、合成/烧炼/附魔、背包管理、村民交易、耕种收获、感知与威胁评估、触发引擎、MCP 接口。

双界面（全屏 TUI / 纯 CLI），模块化 ESM 架构，**246 个单元/编排测试**全绿。

## 快速开始

```bash
npm install

# 1) 配置（二选一）
cp .env.example .env          # 然后编辑 MCBOT_HOST / MCBOT_PORT / MCBOT_USERNAME
# 或复制 config.example.json 为 config.json

# 2) （推荐）密码加密：生成 password.enc + 密钥（写入 .env 的 MCBOT_PASSWORD_KEY）
node setup-security.mjs

# 3) 启动
npm start            # 按 .env 的 MCBOT_UI 加载 cli.mjs 或 tui.mjs
node index.js --tui  # 强制 TUI
node index.js --cli  # 强制 CLI

# 4) MCP 服务器（供外部 AI/脚本调用）
npm run mcp          # stdio（默认）
npm run mcp:sse      # SSE
```

## 配置

优先级：**环境变量 > 加密文件 > config.json**

| 变量 | 说明 |
|---|---|
| `MCBOT_HOST` / `MCBOT_PORT` | 服务器地址 |
| `MCBOT_USERNAME` | 机器人用户名 |
| `MCBOT_AUTH` | `offline` 离线模式等 |
| `MCBOT_PASSWORD` | 明文密码（**调试用**，设置后覆盖加密文件） |
| `MCBOT_PASSWORD_KEY` | 32 字节（64 位 hex）AES-256-CBC 密钥，解密 `password.enc` |
| `MCBOT_UI` | `cli` / `tui` |

⚠️ `.env` 里的 `MCBOT_PASSWORD` 应保持为空，让加密文件生效；`.env`、`password.enc` 均不入库。

## CLI 命令（`!` 或全角 `！` 前缀）

| 分类 | 命令 |
|---|---|
| 移动 | `!f/前` `!b/后` `!l/左` `!r/右` `!jump` `!sneak` `!stop` `!move <x> <y> <z>` |
| 动作 | `!attack` `!use` `!sleep` `!wake` |
| 战斗 | `!combat`/`!combat-off`（自动战斗）`!pvp`/`!pvp-off` `!aggro nearest\|threat`（索敌模式） |
| 感知 | `!scan` `!players` `!entities` `!blocks` `!find <方块>` `!danger` `!threat`（威胁排序） |
| 挖掘/建造 | `!mine <方块> [数量]` `!build <wall\|floor\|box\|pillar> <方块> <x1 y1 z1 x2 y2 z2>` |
| 合成 | `!recipes <物品>` `!craft <物品> [数量]` `!smelt <物品> [数量]` `!enchant <物品> [次数] [省]` `!gear` |
| 背包 | `!inv` `!tidy`（一键整理）`!count <物品>` `!place <方块> <x> <y> <z>` `!chest 存/取 ...` |
| 生存 | `!eat`/`!eat-off`（自动进食，默认开）`!harvest`（收获成熟作物并补种） |
| 交互 | `!trade [物品] [数量]`（村民交易）`!follow <玩家名>`/`!follow-off`（跟随） |
| 触发 | `!rule add "when <事件> <匹配式> then <动作>"` `!rule list` `!rule del <n>` |
| 系统 | `!help` `!connect` `!reconnect` `!restart` `!mcp` `!exit` |

聊天唤醒词：`LanBot <指令>`（如 `LanBot 帮助`）。

## 触发引擎示例

```bash
!rule add "when chat contains:签到 then say 签到成功！"
!rule add "when chat /买|sell/i then say 收到"
!rule add "when death * then say 我死了，马上重生"
```

事件：`chat` / `death` / `health` / `join` / `leave`；匹配：`/正则/`、`contains:文本`、`exact:文本`、`*`；
动作：`say <文本>`（支持 `{text}`/`{player}` 插值）。规则持久化到 `rules.json`，重启自动恢复。

## MCP 工具（26 个）

`send_chat` `get_status` `get_players` `get_position` `get_inventory` `tidy_inventory` `get_recipes` `craft_item` `equip_gear` `attack_nearest` `mine_block` `build_blueprint` `smelt_item` `enchant_item` `harvest_crops` `list_trades` `trade_with` `threat_report` `chest_deposit` `chest_withdraw` `move_to` `stop_move` `follow_player` `unfollow` `connect` `disconnect`

stdio 模式下**日志只写 stderr**，stdout 专用于协议。

## 架构

```
index.js            # 入口：按 --tui/--cli 或配置动态 import 界面
cli.mjs / tui.mjs   # 两种界面（tui 为自研 ANSI 重绘，非 ink）
mcp-server.mjs      # MCP 服务器（全局单例 bot，26 工具）
lib/
  bot.mjs           # 核心：连接/重连/重生/事件编排（各能力域薄包装）
  nav/              # 自研移动引擎（A* + 门交互，完全替代 mineflayer-pathfinder）
  perception/       # 主动扫描 + 被动监听 + 威胁评估（threatScore 距离/武器加权）
  combat.mjs        # 战斗 controller（PvE/PvP，nearest/threat 索敌，与 nav 单写者协调）
  craft|smelt|enchant.mjs  # 合成/烧炼/附魔（纯函数决策 + 注入式编排工厂）
  mining|farming.mjs       # 挖掘/耕种（同上）
  follow|trade.mjs         # 跟随/交易（同上）
  inventory|containers.mjs # 背包整理/箱子存取（纯函数规划）
  survival.mjs      # 自动进食（副手进食，默认开）
  triggers.mjs      # 触发引擎（规则持久化 rules.json）
  lifecycle.mjs     # 自动重生/重连决策
  i18n.mjs          # 中文翻译（zh_cn.json）
index.d.ts          # TypeScript 类型声明
```

**分层设计**：每个能力域 = 「零依赖纯函数（决策/规划/表）」+「注入式编排工厂 `createXxx(deps)`（假 bot 可测）」+「bot.mjs 薄包装（注入真实 bot/nav）」。运行期编排曾有 bug 因硬绑单例而测不到（如 `!mine` 剥皮 Block、烧炼误吃原料），现已按此模式逐步收敛。

## 测试

```bash
npm test            # 246 个用例（mocha + chai）
npm run test:watch
npm run test:coverage   # nyc
```

覆盖：所有能力域的纯函数单测 + 关键运行期编排的假 bot 测试（farming/mining/smelt 已接入，假 bot 显式校验 mineflayer API 契约，如 `bot.dig` 需真 Block）。

## 已知限制

- 所有功能经单元/编排测试验证，**尚未在真实服务器做端到端联调**
- 门逻辑为自研 nav 硬约束（不引 pathfinder）；如需第三方引擎应作为 `MCBOT_NAV` 可选后端并行
- 酿造、红石交互等 MCC 能力尚未实现

## 安全

- `password.enc` 格式 `<iv-hex>:<ciphertext-hex>`，AES-256-CBC，密钥 32 字节 hex
- Node 24 无 `createCipher`，仅 `createCipheriv`；密文一律 hex 文本落盘（避免 Buffer→utf8 损坏）
- 换机器重跑 `node setup-security.mjs`；密钥丢失只能重新初始化

## License

见 [LICENSE](LICENSE)。
