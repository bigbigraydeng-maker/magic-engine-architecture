/**
 * Collected Posts Database Operations
 */

import { supabaseAdmin as supabase, verifyProjectOwnership } from '@/lib/supabase';
import { CollectedPost, EngagementMetrics } from '@/types/crazy-content';

/**
 * Get collected posts for a project
 */
export async function getCollectedPosts(
  projectId: string,
  options?: {
    platform?: 'facebook' | 'xiaohongshu';
    limit?: number;
    offset?: number;
  }
): Promise<{ items: CollectedPost[]; total: number }> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  // Get source IDs for this project
  const { data: sources, error: sourcesError } = await supabase
    .from('social_sources')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true);

  if (sourcesError) {
    throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
  }

  const sourceIds = (sources || []).map((s) => s.id);
  if (sourceIds.length === 0) {
    return { items: [], total: 0 };
  }

  let query = supabase
    .from('collected_posts')
    .select('*', { count: 'exact' })
    .in('source_id', sourceIds)
    .order('collected_at', { ascending: false });

  if (options?.platform) {
    query = query.eq('platform', options.platform);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch collected posts: ${error.message}`);
  }

  return {
    items: (data || []).map(formatPostResponse),
    total: count || 0,
  };
}

/**
 * Create collected post (from scraping)
 */
export async function createCollectedPost(
  sourceId: string,
  input: {
    external_post_id: string;
    platform: 'facebook' | 'xiaohongshu';
    content: string;
    image_urls?: string[];
    original_url?: string;
    published_at?: Date;
    metrics: EngagementMetrics;
  }
): Promise<CollectedPost> {
  // Validate platform
  const validPlatforms = ['facebook', 'xiaohongshu'];
  if (!validPlatforms.includes(input.platform)) {
    throw new Error(`Invalid platform. Must be one of: ${validPlatforms.join(', ')}`);
  }

  // Validate metrics
  if (typeof input.metrics.likes !== 'number' || input.metrics.likes < 0) {
    throw new Error('Invalid metrics: likes must be a non-negative number');
  }
  if (typeof input.metrics.comments !== 'number' || input.metrics.comments < 0) {
    throw new Error('Invalid metrics: comments must be a non-negative number');
  }
  if (typeof input.metrics.shares !== 'number' || input.metrics.shares < 0) {
    throw new Error('Invalid metrics: shares must be a non-negative number');
  }
  if (typeof input.metrics.views !== 'number' || input.metrics.views < 0) {
    throw new Error('Invalid metrics: views must be a non-negative number');
  }

  const { data, error } = await supabase
    .from('collected_posts')
    .insert([
      {
        source_id: sourceId,
        external_post_id: input.external_post_id,
        platform: input.platform,
        content: input.content,
        image_urls: input.image_urls,
        original_url: input.original_url,
        published_at: input.published_at?.toISOString(),
        metrics: input.metrics,
      },
    ])
    .select()
    .single();

  if (error) {
    // Check for duplicate
    if (error.code === '23505') {
      throw new Error(`Post already collected: ${input.external_post_id}`);
    }
    throw new Error(`Failed to create collected post: ${error.message}`);
  }

  return formatPostResponse(data);
}

/**
 * Update collected post metrics
 */
export async function updateCollectedPostMetrics(
  postId: string,
  metrics: EngagementMetrics
): Promise<CollectedPost> {
  // Validate metrics
  if (typeof metrics.likes !== 'number' || metrics.likes < 0) {
    throw new Error('Invalid metrics: likes must be a non-negative number');
  }

  const { data, error } = await supabase
    .from('collected_posts')
    .update({ metrics })
    .eq('id', postId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update post metrics: ${error.message}`);
  }

  return formatPostResponse(data);
}

/**
 * Get high-engagement posts
 */
export async function getHighEngagementPosts(
  projectId: string,
  minScore: number = 75,
  limit: number = 10
): Promise<CollectedPost[]> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Get source IDs for this project
  const { data: sources, error: sourcesError } = await supabase
    .from('social_sources')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true);

  if (sourcesError) {
    throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
  }

  const sourceIds = (sources || []).map((s) => s.id);
  if (sourceIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('collected_posts')
    .select('*')
    .in('source_id', sourceIds)
    .gte('metrics->views', 100) // At least 100 views
    .order('collected_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch high engagement posts: ${error.message}`);
  }

  // Filter by engagement score (calculated client-side for now)
  return (data || [])
    .map(formatPostResponse)
    .filter((post) => calculateEngagementScore(post.metrics) >= minScore);
}

/**
 * Calculate engagement score for a post
 */
function calculateEngagementScore(metrics: EngagementMetrics): number {
  if (metrics.views === 0) return 0;
  const score = ((metrics.likes * 1 + metrics.comments * 2.5 + metrics.shares * 3) / metrics.views) * 100;
  return Math.min(score, 100);
}

/**
 * Format post response
 */
function formatPostResponse(data: any): CollectedPost {
  return {
    ...data,
    collected_at: new Date(data.collected_at),
    published_at: data.published_at ? new Date(data.published_at) : undefined,
  };
}
