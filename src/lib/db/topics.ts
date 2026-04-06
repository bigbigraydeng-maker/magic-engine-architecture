/**
 * Content Topics Database Operations
 */

import { supabase, verifyProjectOwnership } from '@/lib/supabase';
import { ContentTopic } from '@/types/crazy-content';

/**
 * Get all topics for a project
 */
export async function getTopics(projectId: string): Promise<ContentTopic[]> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('content_topics')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch topics: ${error.message}`);
  }

  return (data || []).map(formatTopicResponse);
}

/**
 * Get single topic
 */
export async function getTopic(projectId: string, topicId: string): Promise<ContentTopic | null> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('content_topics')
    .select('*')
    .eq('id', topicId)
    .eq('project_id', projectId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch topic: ${error.message}`);
  }

  return data ? formatTopicResponse(data) : null;
}

/**
 * Create new topic
 */
export async function createTopic(
  projectId: string,
  input: {
    name: string;
    description?: string;
    keywords: string[];
    target_audience?: string;
    tone?: 'professional' | 'casual' | 'inspirational';
    frequency_daily?: number;
  }
): Promise<ContentTopic> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Validate required fields
  if (!input.name || !input.keywords || input.keywords.length === 0) {
    throw new Error('Missing required fields: name, keywords');
  }

  // Validate tone if provided
  const validTones = ['professional', 'casual', 'inspirational'];
  if (input.tone && !validTones.includes(input.tone)) {
    throw new Error(`Invalid tone. Must be one of: ${validTones.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('content_topics')
    .insert([
      {
        project_id: projectId,
        name: input.name,
        description: input.description,
        keywords: input.keywords,
        target_audience: input.target_audience,
        tone: input.tone || 'professional',
        frequency_daily: input.frequency_daily || 1,
        enabled: true,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create topic: ${error.message}`);
  }

  return formatTopicResponse(data);
}

/**
 * Update topic
 */
export async function updateTopic(
  projectId: string,
  topicId: string,
  input: Partial<{
    name: string;
    description: string;
    keywords: string[];
    target_audience: string;
    tone: 'professional' | 'casual' | 'inspirational';
    frequency_daily: number;
    enabled: boolean;
  }>
): Promise<ContentTopic> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Verify topic belongs to project
  const topic = await getTopic(projectId, topicId);
  if (!topic) {
    throw new Error('Topic not found');
  }

  // Validate tone if provided
  if (input.tone) {
    const validTones = ['professional', 'casual', 'inspirational'];
    if (!validTones.includes(input.tone)) {
      throw new Error(`Invalid tone. Must be one of: ${validTones.join(', ')}`);
    }
  }

  const { data, error } = await supabase
    .from('content_topics')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', topicId)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update topic: ${error.message}`);
  }

  return formatTopicResponse(data);
}

/**
 * Delete topic (soft delete via enabled flag)
 */
export async function deleteTopic(projectId: string, topicId: string): Promise<void> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Verify topic belongs to project
  const topic = await getTopic(projectId, topicId);
  if (!topic) {
    throw new Error('Topic not found');
  }

  const { error } = await supabase
    .from('content_topics')
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', topicId)
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to delete topic: ${error.message}`);
  }
}

/**
 * Format topic response (convert date strings to Date objects)
 */
function formatTopicResponse(data: any): ContentTopic {
  return {
    ...data,
    created_at: new Date(data.created_at),
    updated_at: new Date(data.updated_at),
  };
}
