/**
 * Base Collector Class - Abstract foundation for all datasource collectors
 * P8.C.1: Each datasource has a dedicated collector following this interface
 */

import { IDataSourceCollector } from '@/types/monthly-report'
import { createClient } from '@supabase/supabase-js'

export abstract class DataSourceCollectorBase implements IDataSourceCollector {
  name: string = ''
  datasource_type: string = ''

  protected supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  )

  /**
   * Collect raw data from datasource
   * Must be implemented by subclasses
   */
  abstract collect(clientId: string, month: string): Promise<any>

  /**
   * Validate collected data structure
   * Override in subclass if custom validation needed
   */
  validate(data: any): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    return true
  }

  /**
   * Transform raw data to normalized metrics
   * Must be implemented by subclasses
   */
  abstract normalize(data: any): any

  /**
   * Store collected data in Supabase
   * Common pattern: upsert to datasource_report_sections
   */
  protected async storeSection(reportId: number, sectionData: any): Promise<void> {
    const { error } = await this.supabase
      .from('datasource_report_sections')
      .upsert(
        {
          report_id: reportId,
          section_type: this.datasource_type,
          section_data: sectionData,
          last_updated: new Date().toISOString(),
        },
        { onConflict: 'report_id,section_type' }
      )

    if (error) {
      throw new Error(`Failed to store ${this.datasource_type} section: ${error.message}`)
    }
  }

  /**
   * Get existing report for client and month
   */
  protected async getExistingReport(clientId: string, month: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('datasource_monthly_reports')
      .select('id')
      .eq('client_id', clientId)
      .eq('month', month)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      throw new Error(`Failed to get existing report: ${error.message}`)
    }

    return data?.id || null
  }

  /**
   * Create or update monthly report with collected metrics
   */
  protected async updateReport(
    clientId: string,
    month: string,
    metrics: Record<string, any>
  ): Promise<number> {
    let reportId = await this.getExistingReport(clientId, month)

    if (!reportId) {
      // Create new report
      const { data, error } = await this.supabase
        .from('datasource_monthly_reports')
        .insert({
          client_id: clientId,
          month,
          ...metrics,
          last_synced_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error) {
        throw new Error(`Failed to create report: ${error.message}`)
      }

      reportId = data.id
    } else {
      // Update existing report
      const { error } = await this.supabase
        .from('datasource_monthly_reports')
        .update({
          ...metrics,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', reportId)

      if (error) {
        throw new Error(`Failed to update report: ${error.message}`)
      }
    }

    return reportId as number
  }

  /**
   * Helper: Parse month string to Date
   */
  protected parseMonth(month: string): Date {
    const [year, monthNum] = month.split('-')
    return new Date(parseInt(year), parseInt(monthNum) - 1, 1)
  }

  /**
   * Helper: Format month as YYYY-MM
   */
  protected formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
}
