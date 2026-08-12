/**
 * 原子落库 RPC 的 migration 形状与权限判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 这份 migration **尚未 apply**（apply 是单独授权的运维动作 A5）。这些测试读的是
 *    SQL 文本 —— 它们保证的是「这份文件写对了」，不是「生产库里已经这样了」。
 *    两件事不许混：文件名不是 apply 证据（WP00 §2 规则 2）。
 *
 * 仿 `src/lib/geo-measurement-store/__tests__/migration-shape.test.ts` 的写法。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const FILE = 'supabase/migrations/20260812000001_me2_geo_persist_batch_atomic_v1.sql'
const SQL = readFileSync(join(ROOT, FILE), 'utf8')

/**
 * 去掉 `--` 注释后的 SQL。
 *
 * 🔴 判据必须落在**真正会被执行的 SQL** 上。第一版直接 `SQL.not.toContain('SECURITY DEFINER')`
 *    当场红了 —— 因为文件头的注释里正解释着「为什么刻意不用 SECURITY DEFINER」。
 *    一个会被自己的说明文字触发的判据，等于把注释当代码检查。
 */
const CODE = SQL.split('\n')
  .map((line) => {
    const i = line.indexOf('--')
    return i === -1 ? line : line.slice(0, i)
  })
  .join('\n')

describe('函数存在且形状对', () => {
  it('建的是 geo_persist_batch_v1，四个入参', () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.geo_persist_batch_v1\(\s*p_client_id\s+uuid,\s*p_batch\s+jsonb,\s*p_observations\s+jsonb,\s*p_evidence\s+jsonb\s*\)/,
    )
  })

  it('是 plpgsql —— 函数体跑在单个事务里，这是原子性的全部来源', () => {
    expect(SQL).toContain('LANGUAGE plpgsql')
  })

  it('三张表都在同一个函数体内写', () => {
    expect(SQL).toContain('INSERT INTO public.geo_batches')
    expect(SQL).toContain('INSERT INTO public.geo_observations')
    expect(SQL).toContain('INSERT INTO public.geo_evidence')
  })
})

describe('🔴 权限：最小化，不提权', () => {
  it('刻意不是 SECURITY DEFINER —— 调用方 service_role 本来就有权限，DEFINER 只会凭空造提权面', () => {
    expect(CODE).not.toContain('SECURITY DEFINER')
    // 而且理由要写在文件里，不能只活在 PR 描述里。
    expect(SQL).toMatch(/刻意不用 SECURITY DEFINER|刻意是 INVOKER/)
  })

  it('search_path 显式钉死（即便是 INVOKER 也不能被会话设置牵着走）', () => {
    expect(CODE).toMatch(/SET search_path = public, pg_temp/)
  })

  it('EXECUTE 先从 PUBLIC / anon / authenticated 全撤', () => {
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.geo_persist_batch_v1[\s\S]*?FROM PUBLIC, anon, authenticated/)
  })

  it('EXECUTE 只授给 service_role', () => {
    expect(SQL).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.geo_persist_batch_v1[\s\S]*?TO service_role/)
    // 🔴 不许顺手授给别的角色。判据必须是「角色清单**恰好**是 service_role」——
    //    只断言「包含 service_role」的话，`TO service_role, authenticated;` 照样通过，
    //    那道闸等于不存在（变异验证当场抓到了这一点）。
    const grants = CODE.match(/GRANT[\s\S]*?;/g) ?? []
    expect(grants.length).toBeGreaterThan(0)
    for (const g of grants) {
      const roles = (g.match(/\bTO\s+([\s\S]*?);/) ?? [])[1]
      expect(roles, `GRANT 语句里找不到角色清单：${g}`).toBeDefined()
      const list = (roles ?? '').split(',').map((r) => r.trim()).filter((r) => r.length > 0)
      expect(list, `除 service_role 外不许授权，实际授给了：${list.join(', ')}`).toEqual(['service_role'])
    }
  })
})

describe('🔴 回滚语义', () => {
  it('没有 EXCEPTION 块 —— 捕获异常会开子事务，可能把「部分成功」变成可提交状态', () => {
    expect(CODE).not.toMatch(/\bEXCEPTION\s+WHEN\b/)
  })

  it('校验不过一律 RAISE EXCEPTION（而不是返回一个错误码继续跑）', () => {
    expect((CODE.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })
})

describe('🔴 GENERATED 列不许出现在 INSERT 列清单里', () => {
  it('geo_evidence 用显式列清单，且不含 raw_response_locator', () => {
    const block = SQL.slice(SQL.indexOf('INSERT INTO public.geo_evidence'), SQL.indexOf('-- ── 事务内自检'))
    expect(block).toContain('id, client_id, observation_id, raw_response, raw_response_unknown_reason, citations, created_at')
    expect(block, 'raw_response_locator 是 GENERATED ALWAYS 列，写进去 Postgres 会直接拒').not.toContain(
      'raw_response_locator,',
    )
  })

  it('geo_evidence 不用 SELECT *（那会带上 GENERATED 列）', () => {
    const block = SQL.slice(SQL.indexOf('INSERT INTO public.geo_evidence'), SQL.indexOf('-- ── 事务内自检'))
    expect(block).not.toMatch(/SELECT \* FROM jsonb_populate_recordset\(NULL::public\.geo_evidence/)
  })
})

describe('租户闸在事务内', () => {
  it('批次 client_id 必须等于声明的租户', () => {
    expect(SQL).toMatch(/v_batch_client IS DISTINCT FROM p_client_id/)
  })

  it('每条观测的 client_id 与 batch_id 都要核', () => {
    expect(SQL).toMatch(/o\.value ->> 'client_id'\)::uuid IS DISTINCT FROM p_client_id/)
    expect(SQL).toMatch(/o\.value ->> 'batch_id'\)::uuid\s+IS DISTINCT FROM v_batch_id/)
  })

  it('每条证据的 client_id 也要核', () => {
    expect(SQL).toMatch(/e\.value ->> 'client_id'\)::uuid IS DISTINCT FROM p_client_id/)
  })

  it('成功观测缺证据 ⇒ 在事务内就拒（库层拦不住这一条）', () => {
    expect(SQL).toMatch(/成功观测没有对应证据行，整批回滚/)
  })
})

describe('PostgREST 可见性', () => {
  it('发了 schema reload —— 不发的话第一次 .rpc() 会报「函数不存在」，看起来像没 apply', () => {
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema'")
  })
})

describe('不夹带别的东西', () => {
  it('只建函数，不建表、不改表、不动 RLS 策略', () => {
    expect(CODE).not.toMatch(/CREATE TABLE/i)
    expect(CODE).not.toMatch(/ALTER TABLE/i)
    expect(CODE).not.toMatch(/CREATE POLICY/i)
    expect(CODE).not.toMatch(/DROP TRIGGER/i)
  })

  it('不碰 WP03 那份 migration', () => {
    expect(SQL).not.toContain('20260811000001_me2_geo_measurement_storage_v1')
  })
})
