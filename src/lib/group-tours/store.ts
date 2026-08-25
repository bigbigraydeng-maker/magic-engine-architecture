import { supabaseAdmin } from '@/lib/supabase'
import type { GroupTourPayload } from './types'

export type GroupTourStatus = 'draft' | 'review' | 'ready' | 'pr_open' | 'published' | 'archived'

export const GROUP_TOUR_STATUS_LABEL: Record<GroupTourStatus, string> = {
  draft: '草稿',
  review: '待审核',
  ready: '可发布',
  pr_open: '已提交，等待合并',
  published: '已上线',
  archived: '已归档',
}

export interface GroupTourSummary {
  id: string
  status: GroupTourStatus
  title: string
  slug: string
  payload: GroupTourPayload
  pr_url: string | null
  pr_number: number | null
  published_at: string | null
  updated_at: string
  created_at: string
}

export interface GroupTourRecord extends GroupTourSummary {
  client_id: string
  confidence_notes: string[]
  client_claims_to_verify: Array<{ claim: string; issue: string }>
  missing_fields: string[]
  required_fields_confirmed: boolean
  source_document_name: string | null
  source_document_kind: string | null
}

/** 服务端组件直读，避免自己调自己的 API 路由。 */
export async function listGroupTours(clientId: string): Promise<GroupTourSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .select('id,status,title,slug,payload,pr_url,pr_number,published_at,updated_at,created_at')
    .eq('client_id', clientId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as GroupTourSummary[]
}

export async function getGroupTour(clientId: string, tourId: string): Promise<GroupTourRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .select('*')
    .eq('client_id', clientId)
    .eq('id', tourId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as GroupTourRecord | null
}
