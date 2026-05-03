/**
 * Generation Logs Database Operations
 */

import { supabaseAdmin as supabase, verifyProjectOwnership } from '@/lib/supabase';
import { GenerationLog } from '@/types/crazy-content';

/**
 * Log a generation operation
 */
export async function logGeneration(input: {
  project_id: string;
  task_id?: string;
  operation: 'generate_copy' | 'generate_image' | 'scrape_feedback' | 'create_report';
  input_prompt?: Record<string, unknown>;
  output_result?: Record<string, unknown>;
  cost_usd?: number;
  duration_ms?: number;
  status: 'success' | 'failed';
  error_message?: string;
}): Promise<GenerationLog> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(input.project_id);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Validate operation
  const validOperations = ['generate_copy', 'generate_image', 'scrape_feedback', 'create_report'];
  if (!validOperations.includes(input.operation)) {
    throw new Error(`Invalid operation. Must be one of: ${validOperations.join(', ')}`);
  }

  // Validate status
  const validStatuses = ['success', 'failed'];
  if (!validStatuses.includes(input.status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('generation_logs')
    .insert([
      {
        project_id: input.project_id,
        task_id: input.task_id,
        operation: input.operation,
        input_prompt: input.input_prompt,
        output_result: input.output_result,
        cost_usd: input.cost_usd,
        duration_ms: input.duration_ms,
        status: input.status,
        error_message: input.error_message,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Failed to log generation:', error);
    // Don't throw - logging failure shouldn't break the app
    throw new Error(`Failed to log generation: ${error.message}`);
  }

  return formatLogResponse(data);
}

/**
 * Get logs for a project
 */
export async function getLogs(
  projectId: string,
  options?: {
    operation?: string;
    status?: 'success' | 'failed';
    limit?: number;
    offset?: number;
  }
): Promise<{ items: GenerationLog[]; total: number }> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let query = supabase
    .from('generation_logs')
    .select('*', { count: 'exact' })
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (options?.operation) {
    query = query.eq('operation', options.operation);
  }

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch logs: ${error.message}`);
  }

  return {
    items: (data || []).map(formatLogResponse),
    total: count || 0,
  };
}

/**
 * Get cost summary for a project
 */
export async function getCostSummary(
  projectId: string,
  days: number = 30
): Promise<{
  total_cost: number;
  operation_breakdown: Record<string, number>;
  daily_average: number;
}> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('generation_logs')
    .select('operation, cost_usd')
    .eq('project_id', projectId)
    .eq('status', 'success')
    .gte('created_at', startDate.toISOString());

  if (error) {
    throw new Error(`Failed to fetch cost summary: ${error.message}`);
  }

  let totalCost = 0;
  const operationBreakdown: Record<string, number> = {};

  (data || []).forEach((log: any) => {
    const cost = log.cost_usd || 0;
    totalCost += cost;
    operationBreakdown[log.operation] = (operationBreakdown[log.operation] || 0) + cost;
  });

  return {
    total_cost: parseFloat(totalCost.toFixed(6)),
    operation_breakdown: Object.fromEntries(
      Object.entries(operationBreakdown).map(([op, cost]) => [
        op,
        parseFloat((cost as number).toFixed(6)),
      ])
    ),
    daily_average: parseFloat((totalCost / days).toFixed(6)),
  };
}

/**
 * Format log response
 */
function formatLogResponse(data: any): GenerationLog {
  return {
    ...data,
    created_at: new Date(data.created_at),
  };
}
