const MAP_RADIUS = 5

export function getMinimap(botRef, radius = MAP_RADIUS) {
  if (!botRef || !botRef.entity || !botRef.registry) return null
  const size = radius * 2 + 1
  const grid = []
  for (let i = 0; i < size; i++) grid.push(new Array(size).fill(' '))

  const p = botRef.entity
  const { x, y, z } = p.position
  const yaw = p.yaw

  // 前方向量 / 右侧向量（世界坐标）
  const Fx = -Math.sin(yaw)
  const Fz = Math.cos(yaw)
  const Rx = -Fz
  const Rz = Fx

  const layerY = Math.floor(y)
  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      const dxr = sx - radius
      const dzr = sy - radius
      const wx = Math.round(x + dxr * Rx + dzr * (-Fx))
      const wz = Math.round(z + dxr * Rz + dzr * (-Fz))
      const b = botRef.blockAt(wx, layerY, wz)
      let ch = ' '
      if (b) {
        if (b.name === 'water') ch = '≈'
        else if (b.name === 'lava') ch = '∆'
        else if (b.boundingBox === 'block') ch = '#'
        else if (b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') ch = ','
      }
      grid[sy][sx] = ch
    }
  }

  for (const id in botRef.entities) {
    const e = botRef.entities[id]
    if (!e || e === p || !e.position) continue
    const dx = e.position.x - x
    const dz = e.position.z - z
    if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue
    const sx = radius + Math.round(dx * Rx + dz * Rz)
    const sy = radius + Math.round(dx * (-Fx) + dz * (-Fz))
    if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue
    if (e.type === 'player') grid[sy][sx] = 'P'
    else if (e.type === 'mob' || e.type === 'hostile' || e.type === 'neutral') grid[sy][sx] = '!'
  }

  const cx = radius
  const cy = radius
  if (grid[cy][cx] !== '!' && grid[cy][cx] !== 'P') grid[cy][cx] = '@'

  return grid.map(row => row.join(''))
}