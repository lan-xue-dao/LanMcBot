import * as bot from '../../bot.mjs'

let listeners = {}
let trackedEntities = new Set()
let previousState = {
  health: 20,
  food: 20,
  entities: [],
  position: null
}

function isItemEntity(entity) {
  return entity.type === 'object' || entity.name === 'item'
}

export function startPassivePerception(callback) {
  const b = bot.getBot()
  if (!b) return false

  trackedEntities = new Set()

  if (listeners.damage) b.removeListener('health', listeners.damage)
  if (listeners.entitySwing) b.removeListener('entitySwing', listeners.entitySwing)
  if (listeners.entitySpawn) b.removeListener('entitySpawn', listeners.entitySpawn)
  if (listeners.entityGone) b.removeListener('entityGone', listeners.entityGone)

  listeners.damage = (health) => {
    if (health < previousState.health) {
      callback({
        type: 'damage',
        data: {
          health,
          previousHealth: previousState.health,
          damage: previousState.health - health
        }
      })
    }
    previousState.health = health
  }

  listeners.entitySwing = (entity) => {
    if (entity !== b.entity && entity.position?.distanceTo(b.entity.position) < 4) {
      callback({
        type: 'entity_attack',
        data: {
          name: entity.name || entity.username || 'unknown',
          distance: entity.position.distanceTo(b.entity.position).toFixed(1)
        }
      })
    }
  }

  listeners.entitySpawn = (entity) => {
    if (entity === b.entity || isItemEntity(entity)) return
    const dist = entity.position?.distanceTo(b.entity.position)
    if (dist === undefined) return
    if (dist < 8) {
      trackedEntities.add(entity.id)
      callback({
        type: 'entity_approach',
        data: {
          name: entity.name || entity.username || 'unknown',
          distance: dist.toFixed(1)
        }
      })
    }
  }

  listeners.entityGone = (entity) => {
    if (!trackedEntities.has(entity.id)) return
    trackedEntities.delete(entity.id)
    callback({
      type: 'entity_leave',
      data: {
        name: entity.name || entity.username || 'unknown'
      }
    })
  }

  b.on('health', listeners.damage)
  b.on('entitySwing', listeners.entitySwing)
  b.on('entitySpawn', listeners.entitySpawn)
  b.on('entityGone', listeners.entityGone)

  previousState.health = b.health || 20
  previousState.food = b.food || 20

  return true
}

export function stopPassivePerception() {
  const b = bot.getBot()
  if (!b) return

  if (listeners.damage) b.removeListener('health', listeners.damage)
  if (listeners.entitySwing) b.removeListener('entitySwing', listeners.entitySwing)
  if (listeners.entitySpawn) b.removeListener('entitySpawn', listeners.entitySpawn)
  if (listeners.entityGone) b.removeListener('entityGone', listeners.entityGone)

  listeners = {}
  trackedEntities = new Set()
}

export function getStatus() {
  const b = bot.getBot()
  if (!b) return null

  return {
    health: b.health,
    food: b.food,
    position: b.entity?.position ? {
      x: b.entity.position.x.toFixed(1),
      y: b.entity.position.y.toFixed(1),
      z: b.entity.position.z.toFixed(1)
    } : null
  }
}
