/**
 * Tests for the confirmer registry's write side (issue #1669):
 * registerConfirmer / revokeConfirmer. The read side
 * (getRegisteredConfirmerEmails) is already covered via read.test.ts's
 * dual-sign gate tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerConfirmer,
  revokeConfirmer,
  KnowledgeConfirmerAuthorizationError,
  type KnowledgeConfirmerWriteClient,
} from '../confirmers'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const GLOBAL_ADMIN = 'ray@magicengine.cloud'

type Row = Record<string, unknown>

interface Fixture {
  portalUsers: Row[]
  confirmers: Row[]
}
let fixture: Fixture

function makeFakeClient(): KnowledgeConfirmerWriteClient {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let isNullFilter: string | null = null

      const builder = {
        eq(column: string, value: unknown) {
          filters[column] = value
          return builder
        },
        is(column: string, _value: null) {
          isNullFilter = column
          return builder
        },
        ilike(column: string, value: string) {
          const rows = table === 'client_portal_users' ? fixture.portalUsers : fixture.confirmers
          const matched = rows.filter((row) => {
            const matchesFilters = Object.entries(filters).every(([k, v]) => row[k] === v)
            const matchesNull = !isNullFilter || row[isNullFilter] === null || row[isNullFilter] === undefined
            const matchesIlike = typeof row[column] === 'string' && (row[column] as string).toLowerCase() === value.toLowerCase()
            return matchesFilters && matchesNull && matchesIlike
          })
          return Promise.resolve({ data: matched, error: null })
        },
      }

      return {
        select: (_columns: string) => builder,
        insert: (row: Record<string, unknown>) => {
          const withId = { id: `confirmer-${fixture.confirmers.length + 1}`, revoked_at: null, revoked_by_email: null, ...row }
          fixture.confirmers.push(withId)
          return Promise.resolve({ data: [withId], error: null })
        },
        update: (fields: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            const row = fixture.confirmers.find((r) => r[column] === value)
            if (row) Object.assign(row, fields)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    },
  }
}

const savedAdminEmails = process.env.ADMIN_EMAILS

beforeEach(() => {
  fixture = {
    portalUsers: [{ id: 'user-1', client_id: CLIENT_A, email: 'owner@ctstours.co.nz', access_type: 'client' }],
    confirmers: [],
  }
  process.env.ADMIN_EMAILS = GLOBAL_ADMIN
})

afterEach(() => {
  if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = savedAdminEmails
})

describe('registerConfirmer', () => {
  it('registers a confirmer who has a real access_type=client account for this client', async () => {
    const sb = makeFakeClient()
    const result = await registerConfirmer(sb, {
      clientId: CLIENT_A,
      confirmerEmail: 'owner@ctstours.co.nz',
      actorEmail: GLOBAL_ADMIN,
    })
    expect(result.alreadyActive).toBe(false)
    expect(fixture.confirmers).toHaveLength(1)
    expect(fixture.confirmers[0]).toMatchObject({
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
    })
  })

  it('rejects a non-global-admin actor', async () => {
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: 'fde@magicengine.cloud' }),
    ).rejects.toThrow(KnowledgeConfirmerAuthorizationError)
    expect(fixture.confirmers).toHaveLength(0)
  })

  it('rejects registering an email with no access_type=client account for this client (issue #1646 requirement)', async () => {
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'stranger@example.com', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/access_type='client'/)
    expect(fixture.confirmers).toHaveLength(0)
  })

  it('rejects an actor registering themselves as the confirmer', async () => {
    fixture.portalUsers.push({ id: 'user-2', client_id: CLIENT_A, email: GLOBAL_ADMIN, access_type: 'client' })
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: GLOBAL_ADMIN, actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/登记人不能把自己登记成客户确认人/)
  })

  it('rejects registering a global admin email as the confirmer (§9.4: admin cannot stand in for the customer)', async () => {
    process.env.ADMIN_EMAILS = `${GLOBAL_ADMIN},other-admin@magicengine.cloud`
    fixture.portalUsers.push({ id: 'user-3', client_id: CLIENT_A, email: 'other-admin@magicengine.cloud', access_type: 'client' })
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'other-admin@magicengine.cloud', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/全局管理员账号不能被登记/)
    delete process.env.ADMIN_EMAILS
  })

  it('is idempotent — registering an already-active confirmer again returns alreadyActive:true without a duplicate row', async () => {
    const sb = makeFakeClient()
    const first = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    const second = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(second.alreadyActive).toBe(true)
    expect(second.id).toBe(first.id)
    expect(fixture.confirmers).toHaveLength(1)
  })

  it('allows re-registering an email whose PRIOR registration was revoked', async () => {
    fixture.confirmers.push({
      id: 'old-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
      revoked_at: '2026-01-01T00:00:00Z',
      revoked_by_email: GLOBAL_ADMIN,
    })
    const sb = makeFakeClient()
    const result = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(result.alreadyActive).toBe(false)
    expect(fixture.confirmers).toHaveLength(2)
  })
})

describe('revokeConfirmer', () => {
  it('revokes an active confirmer, recording revoked_at and revoked_by_email', async () => {
    fixture.confirmers.push({
      id: 'c-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
      revoked_at: null,
      revoked_by_email: null,
    })
    const sb = makeFakeClient()
    await revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(fixture.confirmers[0].revoked_at).toBeTruthy()
    expect(fixture.confirmers[0].revoked_by_email).toBe(GLOBAL_ADMIN)
  })

  it('rejects a non-global-admin actor', async () => {
    fixture.confirmers.push({
      id: 'c-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      revoked_at: null,
      revoked_by_email: null,
    })
    const sb = makeFakeClient()
    await expect(
      revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: 'fde@magicengine.cloud' }),
    ).rejects.toThrow(KnowledgeConfirmerAuthorizationError)
    expect(fixture.confirmers[0].revoked_at).toBeNull()
  })

  it('throws when trying to revoke an email that is not currently an active confirmer', async () => {
    const sb = makeFakeClient()
    await expect(
      revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'never-registered@example.com', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/无需撤销/)
  })
})
