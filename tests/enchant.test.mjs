import { expect } from 'chai'
import { formatEnchantOptions, enchantOptionsReady, pickEnchantOption } from '../lib/enchant.mjs'

// mineflayer 真实结构：level = 所需经验档；-1 表示未就绪
function opts(a, b, c) {
  return [
    { level: a.xp, expected: { enchant: a.e, level: a.el } },
    { level: b.xp, expected: { enchant: b.e, level: b.el } },
    { level: c.xp, expected: { enchant: c.e, level: c.el } }
  ]
}
const READY = opts({ xp: 1, e: 5, el: 1 }, { xp: 2, e: 6, el: 2 }, { xp: 3, e: 7, el: 3 })

describe('enchant: formatEnchantOptions', () => {
  it('归一化三选项（choice/xpLevel/predicted）', () => {
    const f = formatEnchantOptions(READY)
    expect(f).to.have.lengthOf(3)
    expect(f[2]).to.deep.equal({ choice: 2, xpLevel: 3, predicted: { enchant: 7, level: 3 } })
  })
  it('expected 为 -1 时 predicted 置 null（离线服务器无 seed）', () => {
    const f = formatEnchantOptions(opts({ xp: 1, e: -1, el: -1 }, { xp: 2, e: 6, el: 2 }, { xp: 3, e: 7, el: 3 }))
    expect(f[0].predicted).to.equal(null)
    expect(f[1].predicted).to.deep.equal({ enchant: 6, level: 2 })
  })
  it('未就绪选项 xpLevel=-1 保留', () => {
    const f = formatEnchantOptions(opts({ xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }))
    expect(f.every(o => o.xpLevel === -1)).to.equal(true)
  })
  it('空/缺省安全', () => {
    expect(formatEnchantOptions(undefined)).to.deep.equal([])
  })
})

describe('enchant: enchantOptionsReady', () => {
  it('三者 level>=0 → ready', () => {
    expect(enchantOptionsReady(READY)).to.equal(true)
  })
  it('任一 -1 → 未就绪', () => {
    expect(enchantOptionsReady(opts({ xp: 1, e: 5, el: 1 }, { xp: -1, e: -1, el: -1 }, { xp: 3, e: 7, el: 3 }))).to.equal(false)
  })
  it('不足 3 项不算就绪', () => {
    expect(enchantOptionsReady([{ level: 1 }])).to.equal(false)
  })
})

describe('enchant: pickEnchantOption', () => {
  it('默认 best：取经验档最高', () => {
    expect(pickEnchantOption(READY, { botLevel: 10 })).to.deep.equal({ choice: 2, xpLevel: 3 })
  })
  it('cheap：取最低档省经验', () => {
    expect(pickEnchantOption(READY, { botLevel: 10, prefer: 'cheap' })).to.deep.equal({ choice: 0, xpLevel: 1 })
  })
  it('经验不足时降级到付得起的档', () => {
    expect(pickEnchantOption(READY, { botLevel: 2 })).to.deep.equal({ choice: 1, xpLevel: 2 })
  })
  it('一档都付不起返回 null', () => {
    expect(pickEnchantOption(READY, { botLevel: 0 })).to.equal(null)
  })
  it('未就绪（全 -1）返回 null', () => {
    const notReady = opts({ xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 })
    expect(pickEnchantOption(notReady, { botLevel: 30 })).to.equal(null)
  })
  it('botLevel 缺省 0 时返回 null', () => {
    expect(pickEnchantOption(READY, {})).to.equal(null)
  })
})
