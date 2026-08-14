import { createRequire } from 'module'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

const require = createRequire(import.meta.url)
const passwordFile = path.join(process.cwd(), 'password.enc')
const keyEnvVar = 'MCBOT_PASSWORD_KEY'

// 解密密码
function getDecryptedPassword() {
  // 优先使用环境变量（最安全）
  if (process.env[keyEnvVar]) {
    return process.env[keyEnvVar]
  }

  // 从加密文件读取
  try {
    const encrypted = fs.readFileSync(passwordFile, 'utf8')
    const key = crypto.createHash('sha256').update(process.env[keyEnvVar]).digest()

    // 使用前 16 字节作为 IV（初始化向量）
    const iv = key.slice(0, 16)
    const cipherKey = key.slice(16)

    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv)
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    // 如果没有加密文件，返回空字符串（需要初始化）
    if (err.code === 'ENOENT') {
      console.warn('⚠️  密码未初始化，请运行 node setup-security.mjs 或设置环境变量 MCBOT_PASSWORD_KEY')
      return ''
    }
    console.warn('无法读取密码，请设置环境变量或初始化加密文件')
    return ''
  }
}

// 加载配置
function loadConfig() {
  const config = require('../config.json')
  return {
    host: process.env.MCBOT_HOST || config.host || 'play.simpfun.cn',
    port: parseInt(process.env.MCBOT_PORT) || config.port || 40299,
    username: process.env.MCBOT_USERNAME || config.username || 'LanBot',
    auth: process.env.MCBOT_AUTH || config.auth || 'offline',
    password: process.env.MCBOT_PASSWORD || getDecryptedPassword(),
    ui: process.env.MCBOT_UI || config.ui || 'cli'
  }
}

export default loadConfig()
