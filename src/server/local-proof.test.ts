import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canUseLocalProofLogin } from './local-proof'

describe('canUseLocalProofLogin', () => {
  it('allows local hosts only in the development build', () => {
    expect(canUseLocalProofLogin('http://localhost:3000', true)).toBe(true)
    expect(canUseLocalProofLogin('http://127.0.0.1:3000', true)).toBe(true)
    expect(canUseLocalProofLogin('http://localhost:3000', false)).toBe(false)
  })

  it('rejects a non-local host in the development build', () => {
    expect(canUseLocalProofLogin('https://planner.example.com', true)).toBe(
      false,
    )
  })
})

describe('local Worker configuration', () => {
  it('does not require a remote Cloudflare binding', () => {
    const config = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8')

    expect(config).not.toMatch(/"remote"\s*:\s*true/)
    expect(config.match(/"binding"\s*:\s*"ATTACHMENTS"/g)).toHaveLength(1)
  })
})
