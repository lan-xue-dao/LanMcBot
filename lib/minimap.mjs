const MAP_RADIUS = 5

function hexToRgb(hex) {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

const COLOR_TABLE = {
  air: null,
  cave_air: null,
  void_air: null,
  grass_block: '#7fbd6b',
  grass: '#9bcb6b',
  tall_grass: '#9bcb6b',
  fern: '#7aa34f',
  large_fern: '#7aa34f',
  dirt: '#8a6d4d',
  coarse_dirt: '#6d4d3a',
  rooted_dirt: '#8a6d4d',
  mud: '#8b5f50',
  sand: '#e6db9c',
  red_sand: '#c76d2b',
  sandstone: '#d8c98a',
  red_sandstone: '#b86b2d',
  stone: '#808080',
  cobblestone: '#777777',
  deepslate: '#4c4c4c',
  cobbled_deepslate: '#4c4c4c',
  andesite: '#7f7f82',
  diorite: '#c9c9c7',
  granite: '#a3745b',
  gravel_stone: '#7d7a68',
  water: '#3f76e4',
  lava: '#e6651a',
  snow_block: '#f5f5f5',
  ice: '#a8d8ff',
  packed_ice: '#a0c8e8',
  blue_ice: '#7fb5d0',
  sand_snow: '#f5f5f5',
  bedrock: '#4b4b4b',
  obsidian: '#3b3042',
  clay: '#a89dfa',
  mycelium: '#7a6d5f',
  netherrack: '#7a3e2a',
  soul_sand: '#6a564a',
  end_stone: '#e8e4c8',
  oak_planks: '#b19a63',
  spruce_planks: '#9c8a78',
  birch_planks: '#d6cfa8',
  jungle_planks: '#b98d5a',
  acacia_planks: '#c47b3c',
  dark_oak_planks: '#5e4d2f',
  cherry_planks: '#e8b8c2',
  bamboo_planks: '#d0c878',
  mangrove_planks: '#8a6b52',
  stonecutter: '#808080'
}

function classifyBlock(name) {
  if (COLOR_TABLE[name] !== undefined) return COLOR_TABLE[name]
  if (/water/.test(name)) return '#3f76e4'
  if (/lava/.test(name)) return '#e6651a'
  if (/_leaves$/.test(name) || /leaf/.test(name)) return '#4f9e4f'
  if (/_planks$/.test(name)) return '#b39b6b'
  if (/_log$|_wood$/.test(name) || /_stem$/.test(name)) {
    if (name.startsWith('oak_')) return '#8a6d4d'
    if (name.startsWith('spruce_')) return '#5c4a38'
    if (name.startsWith('dark_oak_') || name.startsWith('dark_wood_')) return '#3f3223'
    if (name.startsWith('birch_')) return '#d6cfa8'
    if (name.startsWith('acacia_')) return '#c58a5e'
    if (name.startsWith('jungle_')) return '#84643c'
    if (name.startsWith('cherry_')) return '#f0c8d0'
    if (name.startsWith('mangrove_')) return '#6b4f3f'
    if (name.startsWith('bamboo_')) return '#6b8344'
    return '#5c4a38'
  }
  if (/_ore$/.test(name)) return '#7a7466'
  if (/deepslate|_ore|netherite|_blocks$/.test(name)) return '#4c4c4c'
  if (/cobblestone|_stone$|stone/.test(name)) return '#808080'
  if (/sand/.test(name)) return '#e6db9c'
  if (/dirt|podzol|mycelium|mud/.test(name)) return '#8a6d4d'
  if (/glass|ice|snow/.test(name)) return '#e0f0ff'
  if (/wool/.test(name)) return '#e8e8e8'
  if (/leaves|leaf/.test(name)) return '#4f9e4f'
  if (/glowstone|sea_lantern|shroomlight/.test(name)) return '#ffd48a'
  return '#8f8f8f'
}

function blockColor(b) {
  const c = classifyBlock(b.name)
  if (!c) return null
  try {
    return hexToRgb(c)
  } catch {
    return null
  }
}

// 从上往下找第一个可见方块的颜色（俯视所见，扫描较深以覆盖洞穴/建筑）
function topColor(botRef, wx, wz, layerY) {
  for (let y = layerY + 16; y >= layerY - 16; y--) {
    const b = botRef.blockAt(wx, y, wz)
    if (!b) continue
    if (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air') continue
    return blockColor(b)
  }
  return null
}

export function getMinimap(botRef, radius = MAP_RADIUS) {
  if (!botRef || !botRef.entity || !botRef.registry) return null
  const size = radius * 2 + 1
  const grid = []
  for (let i = 0; i < size; i++) grid.push([])

  const p = botRef.entity
  const { x, z } = p.position
  const layerY = Math.floor(p.position.y)
  const cx = Math.round(x)
  const cz = Math.round(z)

  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      const wx = cx + (sx - radius)
      const wz = cz + (sy - radius)
      grid[sy].push({
        ch: '',
        bg: topColor(botRef, wx, wz, layerY)
      })
    }
  }

  // 实体叠加（取自当前层到附近）
  const markers = []
  for (const id in botRef.entities) {
    const e = botRef.entities[id]
    if (!e || e === p || !e.position) continue
    const dx = Math.round(e.position.x) - cx
    const dz = Math.round(e.position.z) - cz
    if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue
    const sx = radius + dx
    const sy = radius + dz
    if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue
    let marker = ''
    if (e.type === 'player') marker = 'P'
    else if (e.type === 'mob' || e.type === 'hostile' || e.type === 'neutral') marker = '!'
    if (marker) markers[`${sx},${sy}`] = marker
  }
  for (const key in markers) {
    const [sx, sy] = key.split(',').map(Number)
    grid[sy][sx].ch = markers[key]
  }

  grid[radius][radius].ch = '@'
  return grid
}