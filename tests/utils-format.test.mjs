import { expect } from 'chai'
import { formatKickReason } from '../lib/utils.mjs'

describe('utils/formatKickReason', () => {
  it('should pass through plain string', () => {
    expect(formatKickReason('You have been banned')).to.equal('You have been banned')
  })

  it('should join array of strings with " | "', () => {
    expect(formatKickReason(['a', 'b', 'c'])).to.equal('a | b | c')
  })

  it('should extract text from object', () => {
    expect(formatKickReason({ text: 'Kicked by admin' })).to.equal('Kicked by admin')
  })

  it('should recursively format array in extra field', () => {
    expect(formatKickReason({ extra: ['x', 'y'] })).to.equal('x | y')
  })

  it('should JSON.stringify object without text/extra', () => {
    expect(formatKickReason({ a: 1 })).to.equal(JSON.stringify({ a: 1 }))
  })

  it('should stringify null/undefined gracefully', () => {
    expect(formatKickReason(null)).to.equal('null')
    expect(formatKickReason(undefined)).to.equal('undefined')
  })

  it('should stringify numbers', () => {
    expect(formatKickReason(42)).to.equal('42')
  })
})
