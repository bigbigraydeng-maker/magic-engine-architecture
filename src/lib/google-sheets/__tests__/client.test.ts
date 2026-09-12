import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { readSheetValues, GoogleSheetsError, GoogleSheetsNotConfiguredError } from '../client'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function setCreds() {
  process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({
    private_key: privateKey,
    client_email: 'svc@example.iam.gserviceaccount.com',
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
})

describe('readSheetValues', () => {
  it('throws GoogleSheetsNotConfiguredError when no service account is configured', async () => {
    await expect(readSheetValues('sheet-id', 'Tab!A1:B2')).rejects.toBeInstanceOf(
      GoogleSheetsNotConfiguredError,
    )
  })

  it('mints a token then fetches the range, coercing cells to strings', async () => {
    setCreds()
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url)
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok-abc' }) } as Response
      }
      // Sheets API call — assert bearer token was attached.
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer tok-abc')
      return {
        ok: true,
        json: async () => ({ values: [['a', 1, ''], ['b']] }),
      } as Response
    })

    const rows = await readSheetValues('sheet-id', 'CRM管理!A2:S', { fetcher: fetcher as unknown as typeof fetch })

    expect(rows).toEqual([['a', '1', ''], ['b']])
    expect(calls.some((u) => u.includes('sheets.googleapis.com'))).toBe(true)
    expect(calls.some((u) => u.includes(encodeURIComponent('CRM管理!A2:S')))).toBe(true)
  })

  it('surfaces a GoogleSheetsError with the HTTP status on failure', async () => {
    setCreds()
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok-abc' }) } as Response
      }
      return { ok: false, status: 403, text: async () => 'PERMISSION_DENIED' } as Response
    })

    const err = await readSheetValues('sheet-id', 'CRM管理!A2:S', { fetcher: fetcher as unknown as typeof fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleSheetsError)
    expect((err as GoogleSheetsError).httpStatus).toBe(403)
  })

  it('does not pad short rows to a uniform width', async () => {
    setCreds()
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok-abc' }) } as Response
      }
      return { ok: true, json: async () => ({ values: [[], ['only-one']] }) } as Response
    })

    const rows = await readSheetValues('sheet-id', 'Tab!A:Z', { fetcher: fetcher as unknown as typeof fetch })
    expect(rows).toEqual([[], ['only-one']])
  })
})
