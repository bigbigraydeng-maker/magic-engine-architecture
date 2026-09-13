// Shared constants/helpers for 狄仁杰 attack tests. Mocks live in each test file (vi.mock is hoisted per file).
import type { FakeDb, Row } from '@/lib/meta/__tests__/binding-fake-db'

export const A = 'aaaaaaaa-0000-0000-0000-000000000001'
export const B = 'bbbbbbbb-0000-0000-0000-000000000002'
export const C = 'cccccccc-0000-0000-0000-000000000003'
export const ACC_A = 'act_1111111111'
export const ACC_B = 'act_2222222222'
export const ACC_C = 'act_4444444444'
export const ACC_NEW = 'act_3333333333'

export const FDE = 'fde@magiclab.test'
export const ID = {
  client: 'client@a.test',
  dashboard: 'dashboard@a.test',
  both: 'both@a.test',
  fde: 'fde-row@a.test',
  self_serve: 'selfserve@a.test',
  portal: 'portal@a.test',
  scoped_admin: 'scoped@a.test',
  demo: 'demo@anywhere.test',
  viewer: 'viewer@anywhere.test',
  demo_and_admin: 'dual@magiclab.test',
  outsider: 'random@elsewhere.test',
  member_c: 'staff@c.test',
}

export function seed(): FakeDb {
  return {
    clients: [
      { id: A, name: 'Client A', domain: null, facebook_page_id: null, meta_ad_account_id: ACC_A },
      { id: B, name: 'Client B', domain: null, facebook_page_id: null, meta_ad_account_id: ACC_B },
      { id: C, name: 'Client C', domain: null, facebook_page_id: null, meta_ad_account_id: null },
    ],
    client_meta_ad_accounts: [
      { id: 'm1', client_id: A, ad_account_id: ACC_A, is_primary: true, label: '主账户' },
      { id: 'm2', client_id: B, ad_account_id: ACC_B, is_primary: true, label: '主账户' },
    ],
    client_portal_users: [
      { email: ID.client, client_id: A, access_type: 'client', scoped_admin: false },
      { email: ID.dashboard, client_id: A, access_type: 'dashboard', scoped_admin: false },
      { email: ID.both, client_id: A, access_type: 'both', scoped_admin: false },
      { email: ID.fde, client_id: A, access_type: 'fde', scoped_admin: false },
      { email: ID.self_serve, client_id: A, access_type: 'self_serve', scoped_admin: false },
      { email: ID.portal, client_id: A, access_type: 'portal', scoped_admin: false },
      { email: ID.scoped_admin, client_id: A, access_type: 'client', scoped_admin: true },
      { email: ID.member_c, client_id: C, access_type: 'client', scoped_admin: false },
    ],
    client_binding_audit: [],
    flywheel_actions: [],
  }
}

export const snapshot = (db: FakeDb) =>
  JSON.stringify({
    clients: db.clients.map((c: Row) => [c.id, c.meta_ad_account_id]),
    accounts: db.client_meta_ad_accounts.map((r: Row) => [r.client_id, r.ad_account_id, r.is_primary]),
  })

export function setEnv() {
  process.env.ADMIN_EMAILS = `${FDE},${ID.demo_and_admin}`
  process.env.DEMO_ADMINS = `${ID.demo}:${A},${ID.demo_and_admin}:${A}`
  process.env.CLIENT_VIEWERS = `${ID.viewer}:${A}`
  process.env.META_SYSTEM_USER_TOKEN = 'SHARED_FALLBACK_TOKEN'
  delete process.env.ADMIN_EMAIL_DOMAIN
}
