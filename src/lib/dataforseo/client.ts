/**
 * DataForSEO API client
 * Handles authentication and base request logic for all DataForSEO API calls
 */

interface DataForSeoRequestBody {
  [key: string]: unknown
}

interface DataForSeoResponse<T = unknown> {
  version: string
  status_code: number
  status_message: string
  time: string
  cost: number
  tasks_count: number
  tasks_error: number
  tasks: Array<{
    id: string
    status_code: number
    status_message: string
    time: string
    cost: number
    result_count: number
    result?: T[]
  }>
}

export class DataForSeoClient {
  private baseUrl = 'https://api.dataforseo.com/v3'
  private login: string
  private password: string

  constructor() {
    this.login = process.env.DATAFORSEO_LOGIN || ''
    this.password = process.env.DATAFORSEO_PASSWORD || ''

    if (!this.login || !this.password) {
      throw new Error('Missing DataForSEO credentials (DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD)')
    }
  }

  /**
   * Make authenticated request to DataForSEO API
   */
  async request<T = unknown>(
    endpoint: string,
    body: DataForSeoRequestBody
  ): Promise<DataForSeoResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`
    const auth = Buffer.from(`${this.login}:${this.password}`).toString('base64')

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(
        `DataForSEO API error: ${response.status} ${response.statusText}`
      )
    }

    return response.json() as Promise<DataForSeoResponse<T>>
  }

  /**
   * Get backlinks for a domain
   * Endpoint: /backlinks/backlinks
   */
  async getBacklinks(domain: string, limit = 100, offset = 0) {
    return this.request('/backlinks/backlinks', {
      targets: [domain],
      limit,
      offset,
      order_by: ['-date_from'],
    })
  }

  /**
   * Get backlinks summary for a domain
   * Endpoint: /backlinks/summary
   */
  async getBacklinksSummary(domain: string) {
    return this.request('/backlinks/summary', {
      targets: [domain],
    })
  }

  /**
   * Get referring domains for a domain
   * Endpoint: /backlinks/referring_domains
   */
  async getReferringDomains(domain: string, limit = 100, offset = 0) {
    return this.request('/backlinks/referring_domains', {
      targets: [domain],
      limit,
      offset,
      order_by: ['-domain_rank'],
    })
  }
}

export default DataForSeoClient
