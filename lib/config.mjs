import { createRequire } from 'module'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

const require = createRequire(import.meta.url)
const passwordFile = path.join(process.cwd(), 'password.enc')
const envFile = path.join(process.cwd(), '.env')
const KEY_ENV = 'MCBOT_PASSWORD_KEY'

// 极简 .env 解析：KEY=VALUE，忽略空行与 # 注释，不做变量展开
// 不覆盖已存在的真实环境变量（真实环境变量优先级更高）
function loadEnvFile() {
  if (!fs.existsSync(envFile)) return {}
  const out = {}
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim()
  }
  return out
}

const envFileVars = loadEnvFile()

// 取配置项：真实环境变量 > .env 文件
function env(name) {
  return process.env[name] || envFileVars[name] || ''
}

// 解密 password.enc
// 文件格式：<iv-hex>:<ciphertext-hex>，密钥为 32 字节 hex（MCBOT_PASSWORD_KEY）
function getDecryptedPassword() {
  const keyHex = env(KEY_ENV)
  if (!keyHex) return ''
  if (!fs.existsSync(passwordFile)) {
    console.warn('⚠️  未找到 password.enc，请运行 node setup-security.mjs')
    return ''
  }

  try {
    const key = Buffer.from(keyHex, 'hex')
    if (key.length !== 32) {
      console.warn(`⚠️  ${KEY_ENV} 必须是 32 字节（64 位 hex），当前 ${key.length} 字节`)
      return ''
    }

    const raw = fs.readFileSync(passwordFile, 'utf8').trim()
    const sep = raw.indexOf(':')
    if (sep < 0) {
      console.warn('⚠️  password.enc 格式不正确（应为 <iv-hex>:<ciphertext-hex>），请重新运行 node setup-security.mjs')
      return ''
    }

    const iv = Buffer.from(raw.slice(0, sep), 'hex')
    const ciphertext = Buffer.from(raw.slice(sep + 1), 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    console.warn('⚠️  密码解密失败，请确认 MCBOT_PASSWORD_KEY 与 password.enc 匹配')
    console.warn('   错误:', err.message)
    return ''
  }
}

// 加载配置：环境变量 > .env > config.json
function loadConfig() {
  let fileConfig = {}
  try {
    fileConfig = require('../config.json')
  } catch {
    // config.json 可缺失，全部走环境变量
  }

  // 密码优先级：明文环境变量 > 加密文件 > config.json（向后兼容）
  const password = env('MCBOT_PASSWORD') || getDecryptedPassword() || fileConfig.password || ''
  if (!password) {
    console.warn('⚠️  未取得密码：请设置 MCBOT_PASSWORD，或运行 node setup-security.mjs 生成 password.enc')
  }

  return {
    host: env('MCBOT_HOST') || fileConfig.host || 'play.simpfun.cn',
    port: parseInt(env('MCBOT_PORT'), 10) || fileConfig.port || 40299,
    username: env('MCBOT_USERNAME') || fileConfig.username || 'LanBot',
    auth: env('MCBOT_AUTH') || fileConfig.auth || 'offline',
    password,
    ui: env('MCBOT_UI') || fileConfig.ui || 'cli'
  }
}

export default loadConfig()
