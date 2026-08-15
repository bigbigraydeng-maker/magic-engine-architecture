/**
 * product-map-sync 的架构守卫。
 * 豁免按**精确文件名单**,不按目录 —— 目录级放行 = 闸门名存实亡:
 * - fetch 只许 github-rest-provider.ts;
 * - supabase 只许 store.ts;
 * - process.env 全目录禁(token/secret 由 route 层注入);
 * - 全目录禁 import 对外写模块 cms/github-client;
 * - 真件客户端只许读:禁 PUT/PATCH/DELETE。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LIB_DIR = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

const files = sourceFiles(LIB_DIR)

const FETCH_ALLOWED = new Set(['github-rest-provider.ts'])
const SUPABASE_ALLOWED = new Set(['store.ts'])

describe('防空跑', () => {
  it('扫到的源文件数量符合预期', () => {
    expect(files.length).toBeGreaterThanOrEqual(9)
  })
})

describe('精确文件豁免', () => {
  for (const file of files) {
    const name = file.slice(LIB_DIR.length + 1)
    it(name, () => {
      const content = readFileSync(file, 'utf8')
      if (!FETCH_ALLOWED.has(name)) {
        expect(/\bfetch\s*\(/.test(content), `${name} 不许发网络请求`).toBe(false)
      }
      if (!SUPABASE_ALLOWED.has(name)) {
        expect(/@supabase\/|@\/lib\/supabase/.test(content), `${name} 不许碰 supabase`).toBe(false)
      }
      expect(/process\.env/.test(content), `${name} 不许读 env —— 由 route 层注入`).toBe(false)
      // 只匹配 import 语句,注释里解释「为什么不复用」不算违规
      expect(/from\s+'@\/lib\/cms\/github-client/.test(content), `${name} 不许 import 对外写模块`).toBe(false)
    })
  }
})

describe('真件客户端只读', () => {
  it('github-rest-provider 无写方法(PUT/PATCH/DELETE)', () => {
    const content = readFileSync(join(LIB_DIR, 'github-rest-provider.ts'), 'utf8')
    expect(/method:\s*'(PUT|PATCH|DELETE)'/.test(content)).toBe(false)
  })

  it('构造函数不收 owner/repo —— 跨仓输入在结构上不存在', () => {
    const content = readFileSync(join(LIB_DIR, 'github-rest-provider.ts'), 'utf8')
    expect(/owner\s*[:?]/.test(content.split('interface ProviderOptions')[1]?.split('}')[0] ?? '')).toBe(false)
    expect(content).toContain('APPROVED_REPO')
  })
})
