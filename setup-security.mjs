#!/usr/bin/env node
/**
 * mcbot 安全初始化脚本
 *
 * 功能：
 * 1. 生成加密密钥
 * 2. 加密密码
 * 3. 创建 .env 和 .env.example
 * 4. 更新 .gitignore
 */

import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

const PASSWORD_FILE = 'password.enc'
const ENV_FILE = '.env'
const ENV_EXAMPLE = '.env.example'
const GITHUBIGNORE = '.gitignore'

console.log('🔐 mcbot 安全初始化工具\n')

// 步骤 1: 生成加密密钥
console.log('步骤 1: 生成加密密钥')
const secretKey = crypto.randomBytes(32)
console.log('✓ 已生成 32 字节加密密钥')
console.log('  密钥:', secretKey.toString('hex'))

// 步骤 2: 加密密码
console.log('\n步骤 2: 加密密码')
let password = process.env.MCBOT_PASSWORD || ''
if (!password) {
  // 如果没有通过环境变量提供，尝试读取 config.json
  try {
    const configPath = path.join(process.cwd(), 'config.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      password = config.password || ''
    }
  } catch (err) {
    // 忽略错误
  }
}

if (!password) {
  password = 'Lanbot' // 默认密码，但提示用户修改
  console.log('⚠️  使用默认密码: Lanbot')
  console.log('   请在生产环境中设置安全的环境变量 MCBOT_PASSWORD')
}

// 加密密码
// secretKey 本身就是 32 字节，直接作为 AES-256 密钥（不再派生，避免两端不一致）
// IV 独立随机生成 16 字节，与密文一起存储：<iv-hex>:<ciphertext-hex>
// 全程用 hex 文本存储，绝不把二进制 Buffer 以 'utf8' 写文件（会被替换成 U+FFFD 而损坏）
const iv = crypto.randomBytes(16)
const cipher = crypto.createCipheriv('aes-256-cbc', secretKey, iv)
const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
const payload = `${iv.toString('hex')}:${encrypted.toString('hex')}`

// 写入加密文件（纯 hex 文本，安全）
fs.writeFileSync(PASSWORD_FILE, payload, 'utf8')
console.log('✓ 已加密密码并保存到 password.enc')

// 立即自检：用同样的密钥解回来，确认端到端可用
{
  const [ivHex, ctHex] = fs.readFileSync(PASSWORD_FILE, 'utf8').trim().split(':')
  const decipher = crypto.createDecipheriv('aes-256-cbc', secretKey, Buffer.from(ivHex, 'hex'))
  const roundTrip = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final()
  ]).toString('utf8')
  if (roundTrip !== password) {
    console.error('✗ 自检失败：解密结果与原密码不一致，已中止')
    process.exit(1)
  }
  console.log('✓ 加解密自检通过')
}

// 步骤 3: 创建 .env 文件
console.log('\n步骤 3: 创建 .env 文件')
const envContent = `# mcbot 配置
# MCBOT_HOST 服务器地址
MCBOT_HOST=${process.env.MCBOT_HOST || 'play.simpfun.cn'}

# MCBOT_PORT 服务器端口
MCBOT_PORT=${process.env.MCBOT_PORT || '40299'}

# MCBOT_USERNAME 机器人用户名
MCBOT_USERNAME=${process.env.MCBOT_USERNAME || 'LanBot'}

# MCBOT_AUTH 认证方式 (offline/microsoft/xbox)
MCBOT_AUTH=${process.env.MCBOT_AUTH || 'offline'}

# MCBOT_PASSWORD 明文密码（留空，密码已加密存于 password.enc）
# 仅在临时调试时才填写，填写后会覆盖加密文件
MCBOT_PASSWORD=

# MCBOT_PASSWORD_KEY 解密 password.enc 所需的 32 字节密钥（64 位 hex）
MCBOT_PASSWORD_KEY=${secretKey.toString('hex')}

# MCBOT_UI UI 模式 (cli/tui)
MCBOT_UI=${process.env.MCBOT_UI || 'cli'}
`

fs.writeFileSync(ENV_FILE, envContent, 'utf8')
console.log('✓ 已创建 .env 文件')

// 步骤 4: 创建 .env.example
console.log('\n步骤 4: 创建 .env.example 文件')
const envExampleContent = `# mcbot 配置示例
# 复制此文件为 .env 并修改配置

# 服务器配置
MCBOT_HOST=your-server.com
MCBOT_PORT=25565
MCBOT_USERNAME=YourUsername

# 认证配置
MCBOT_AUTH=offline

# 密码二选一：
#   1) 明文（优先级最高，适合临时调试）
MCBOT_PASSWORD=
#   2) 加密：运行 node setup-security.mjs 生成 password.enc + 下面这个密钥
#      密钥必须是 32 字节（64 位 hex）
MCBOT_PASSWORD_KEY=

# UI 模式 (cli | tui)
MCBOT_UI=cli
`

fs.writeFileSync(ENV_EXAMPLE, envExampleContent, 'utf8')
console.log('✓ 已创建 .env.example 文件')

// 步骤 5: 更新 .gitignore
console.log('\n步骤 5: 更新 .gitignore')
let gitignoreContent = ''
if (fs.existsSync(GITHUBIGNORE)) {
  gitignoreContent = fs.readFileSync(GITHUBIGNORE, 'utf8')
}

const ignoreEntries = [
  'password.enc',
  '.env',
  '.env.local',
  '*.log',
  'bot_*.log',
  'chat_*.log'
]

// 检查是否已包含，避免重复
const existingIgnores = gitignoreContent.split('\n').filter(line => line.trim())
const newEntries = ignoreEntries.filter(entry => !existingIgnores.includes(entry))

if (newEntries.length > 0) {
  const updatedIgnores = [...existingIgnores, ...newEntries]
  gitignoreContent = updatedIgnores.join('\n') + '\n'
  fs.writeFileSync(GITHUBIGNORE, gitignoreContent, 'utf8')
  console.log('✓ 已更新 .gitignore，添加忽略项:', newEntries.join(', '))
} else {
  console.log('✓ .gitignore 中已包含所有忽略项')
}

// 步骤 6: 使用新配置加载
console.log('\n步骤 6: 使用新配置验证')
console.log('✓ 配置文件已创建，请手动运行 node index.js 测试')
console.log('\n⚠️  注意：')
console.log('  1. password.enc 已添加到 .gitignore，不会被提交到 Git')
console.log('  2. .env 文件也已添加到 .gitignore')
console.log('  3. 请妥善保管密钥文件')
console.log('  4. 在生产环境中，建议使用环境变量传递密码')
console.log('\n✨ 安全初始化完成！')
console.log('\n运行命令:')
console.log('  npm start')
console.log('  或')
console.log('  node index.js')
