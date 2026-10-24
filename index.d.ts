// mcbot TypeScript 类型定义

declare module 'mineflayer' {
  export interface Bot {
    username: string
    health: number
    food: number
    foodSaturation: number
    isSleeping: boolean
    entities: Record<string, Entity>
    players: Record<string, Player>
    position: Vec3
    yaw: number
    pitch: number
    blockAt(pos: vec3, ignoreLoaded?: boolean): Block | null
    chat(message: string): void
    sleep(block: Block, callback?: (err?: Error) => void): void
    wake(): void
    activateItem(): void
    activateBlock(block: Block): void
    placeBlock(reference: Block, face: vec3, callback?: (err?: Error) => void): void
    attack(target: Entity): void
    useOn(target: Entity): void
    setControlState(control: string, state: boolean): void
    look(yaw: number, pitch: number, force?: boolean): void
    setControl(control: string, state: boolean): void
    clearControlState(control: string): void
    clearControls(): void
    findBlock(options: {
      matching?: (block: Block) => boolean
      maxDistance?: number
      count?: number
    }): Block | null
    findBlocks(options: {
      matching?: (block: Block) => boolean
      maxDistance?: number
      count?: number
    }): vec3[]
    inventory: {
      items(): InventoryItem[]
      items(slot?: number): InventoryItem | undefined
    }
    _client?: any
    _properties?: Record<string, any>
  }

  export interface Entity {
    id: number
    name: string
    username?: string
    type: string
    position: Vec3
    velocity?: Vec3
    yaw?: number
    pitch?: number
  }

  export interface Player {
    username: string
    ping: number
    entity?: Entity
  }

  export interface Vec3 {
    x: number
    y: number
    z: number
    offset(x: number, y: number, z: number): Vec3
    distanceTo(other: Vec3): number
    floored(): Vec3
    clone(): Vec3
    plus(other: Vec3): Vec3
  }

  export interface Block {
    name: string
    position: Vec3
    type: number
    metadata: number
    _properties?: Record<string, any>
    shapes?: number[][]
    boundingBox?: string
    count?: number
  }

  export interface InventoryItem {
    name: string
    displayName?: string
    count: number
    type: number
    slot: number
    nbt?: any
  }

  export function createBot(options: {
    host?: string
    port?: number
    username?: string
    auth?: 'offline' | 'microsoft' | 'xbox'
    password?: string
    verbose?: boolean
    [key: string]: any
  }): Bot
}

// 导出配置
export interface Config {
  host: string
  port: number
  username: string
  auth: 'offline' | 'microsoft' | 'xbox'
  password: string
  ui: 'cli' | 'tui'
}

// 导出类型
export type Bot = import('mineflayer').Bot
export type Entity = import('mineflayer').Entity
export type Player = import('mineflayer').Player
export type Vec3 = import('vec3').Vec3
export type Block = import('mineflayer').Block
export type InventoryItem = import('mineflayer').InventoryItem

// 导出函数
export {
  createBot, getBot, destroyBot, isLoggedIn, isReconnecting, sendChat, quitBot,
  setFollow, stopFollow, getFollowTarget, isFollowEnabled, findFollowPlayer
} from './lib/bot.mjs'
// 跟随能力域（纯函数 + 注入式 controller，零 bot 依赖）
export { findPlayerByName, decideFollow, createFollowController } from './lib/follow.mjs'
export { initNav, goto, stop, isMoving, destroy } from './lib/nav/index.mjs'
export { scanEntities, scanPlayers, scanBlocks, findBlock, getDangerLevel } from './lib/perception/index.mjs'
export { startPassivePerception, stopPassivePerception, getStatus } from './lib/perception/index.mjs'
export { translateEntity, translateBlock, translateMessage, blockIdFromZh } from './lib/i18n.mjs'
export { log, chatLog, logRaw } from './lib/logger.mjs'
export { handleCommand } from './lib/commands.mjs'
export { formatKickReason } from './lib/utils.mjs'

// 感知模块导出
export * from './lib/perception/index.mjs'
