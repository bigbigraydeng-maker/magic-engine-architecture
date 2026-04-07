/**
 * Content Tasks Database Operations
 */

import { supabaseAdmin as supabase, verifyProjectOwnership } from '@/lib/supabase';
import { ContentTask } from '@/types/crazy-content';

/**
 * Get all tasks for a project with filtering
 */
export async function getTasks(
  projectId: string,
  options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: ContentTask[]; total: number }> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const limit = options?.limit || 10;
  const offset = options?.offset || 0;

  let query = supabase
    .from('content_tasks')
    .select('*', { count: 'exact' })
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  return {
    items: (data || []).map(formatTaskResponse),
    total: count || 0,
  };
}

/**
 * Get single task
 */
export async function getTask(projectId: string, taskId: string): Promise<ContentTask | null> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('content_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('project_id', projectId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch task: ${error.message}`);
  }

  return data ? formatTaskResponse(data) : null;
}

/**
 * Create new task
 */
export async function createTask(
  projectId: string,
  input: {
    topic_id?: string;
    platforms: ('facebook' | 'xiaohongshu')[];
    scheduled_at?: Date;
  }
): Promise<ContentTask> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Validate platforms
  const validPlatforms = ['facebook', 'xiaohongshu'];
  const invalidPlatforms = input.platforms.filter((p) => !validPlatforms.includes(p));
  if (invalidPlatforms.length > 0) {
    throw new Error(`Invalid platforms: ${invalidPlatforms.join(', ')}`);
  }

  // Verify topic belongs to project if provided
  if (input.topic_id) {
    const { data: topic, error } = await supabase
      .from('content_topics')
      .select('id')
      .eq('id', input.topic_id)
      .eq('project_id', projectId)
      .single();

    if (error || !topic) {
      throw new Error('Topic not found or does not belong to this project');
    }
  }

  const { data, error } = await supabase
    .from('content_tasks')
    .insert([
      {
        project_id: projectId,
        topic_id: input.topic_id,
        platforms: input.platforms,
        status: 'pending',
        scheduled_at: input.scheduled_at?.toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create task: ${error.message}`);
  }

  return formatTaskResponse(data);
}

/**
 * Update task (e.g., mark as completed, set published_at)
 */
export async function updateTask(
  projectId: string,
  taskId: string,
  input: Partial<{
    status: 'pending' | 'generating' | 'publishing' | 'published' | 'completed' | 'failed';
    generated_captions: any;
    image_url: string;
    scheduled_at: Date;
    published_at: Date;
    error_message: string;
  }>
): Promise<ContentTask> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Verify task belongs to project
  const task = await getTask(projectId, taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  // Validate status if provided
  if (input.status) {
    const validStatuses = ['pending', 'generating', 'completed', 'failed'];
    if (!validStatuses.includes(input.status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
  }

  const { data, error } = await supabase
    .from('content_tasks')
    .update({
      ...input,
      scheduled_at: input.scheduled_at?.toISOString(),
      published_at: input.published_at?.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update task: ${error.message}`);
  }

  return formatTaskResponse(data);
}

/**
 * Get pending tasks for generation
 */
export async function getPendingTasks(limit: number = 10): Promise<ContentTask[]> {
  const { data, error } = await supabase
    .from('content_tasks')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch pending tasks: ${error.message}`);
  }

  return (data || []).map(formatTaskResponse);
}

/**
 * Format task response
 */
function formatTaskResponse(data: any): ContentTask {
  return {
    ...data,
    created_at: new Date(data.created_at),
    updated_at: new Date(data.updated_at),
    scheduled_at: data.scheduled_at ? new Date(data.scheduled_at) : undefined,
    published_at: data.published_at ? new Date(data.published_at) : undefined,
  };
}
