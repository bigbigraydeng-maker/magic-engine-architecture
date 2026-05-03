/**
 * Social Sources Database Operations
 */

import { supabaseAdmin as supabase, verifyProjectOwnership } from '@/lib/supabase';
import { SocialSource } from '@/types/crazy-content';

/**
 * Get all sources for a project
 */
export async function getSources(projectId: string): Promise<SocialSource[]> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('social_sources')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch sources: ${error.message}`);
  }

  return (data || []).map(formatSourceResponse);
}

/**
 * Get single source
 */
export async function getSource(projectId: string, sourceId: string): Promise<SocialSource | null> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('social_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('project_id', projectId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch source: ${error.message}`);
  }

  return data ? formatSourceResponse(data) : null;
}

/**
 * Create new social source
 */
export async function createSource(
  projectId: string,
  input: {
    platform: 'facebook' | 'xiaohongshu';
    account_id: string;
    account_name?: string;
    api_token: string;
    token_expires_at?: Date;
  }
): Promise<SocialSource> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Validate platform
  const validPlatforms = ['facebook', 'xiaohongshu'];
  if (!validPlatforms.includes(input.platform)) {
    throw new Error(`Invalid platform. Must be one of: ${validPlatforms.join(', ')}`);
  }

  // Validate required fields
  if (!input.account_id || !input.api_token) {
    throw new Error('Missing required fields: account_id, api_token');
  }

  const { data, error } = await supabase
    .from('social_sources')
    .insert([
      {
        project_id: projectId,
        platform: input.platform,
        account_id: input.account_id,
        account_name: input.account_name,
        api_token: input.api_token,
        token_expires_at: input.token_expires_at?.toISOString(),
        is_active: true,
      },
    ])
    .select()
    .single();

  if (error) {
    // Check for duplicate
    if (error.code === '23505') {
      throw new Error(
        `Social account already connected: ${input.platform}/${input.account_id}`
      );
    }
    throw new Error(`Failed to create source: ${error.message}`);
  }

  return formatSourceResponse(data);
}

/**
 * Update source (e.g., update token, last_sync_at)
 */
export async function updateSource(
  projectId: string,
  sourceId: string,
  input: Partial<{
    account_name: string;
    api_token: string;
    token_expires_at: Date;
    last_sync_at: Date;
    last_error: string;
    is_active: boolean;
  }>
): Promise<SocialSource> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Verify source belongs to project
  const source = await getSource(projectId, sourceId);
  if (!source) {
    throw new Error('Source not found');
  }

  const { data, error } = await supabase
    .from('social_sources')
    .update({
      ...input,
      token_expires_at: input.token_expires_at?.toISOString(),
      last_sync_at: input.last_sync_at?.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update source: ${error.message}`);
  }

  return formatSourceResponse(data);
}

/**
 * Delete source (disable it)
 */
export async function deleteSource(projectId: string, sourceId: string): Promise<void> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  // Verify source belongs to project
  const source = await getSource(projectId, sourceId);
  if (!source) {
    throw new Error('Source not found');
  }

  const { error } = await supabase
    .from('social_sources')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to delete source: ${error.message}`);
  }
}

/**
 * Get active sources for a platform
 */
export async function getActiveSources(
  projectId: string,
  platform: 'facebook' | 'xiaohongshu'
): Promise<SocialSource[]> {
  // Verify ownership
  const isOwner = await verifyProjectOwnership(projectId);
  if (!isOwner) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('social_sources')
    .select('*')
    .eq('project_id', projectId)
    .eq('platform', platform)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to fetch active sources: ${error.message}`);
  }

  return (data || []).map(formatSourceResponse);
}

/**
 * Format source response
 */
function formatSourceResponse(data: any): SocialSource {
  return {
    ...data,
    created_at: new Date(data.created_at),
    updated_at: new Date(data.updated_at),
    token_expires_at: data.token_expires_at ? new Date(data.token_expires_at) : undefined,
    last_sync_at: data.last_sync_at ? new Date(data.last_sync_at) : undefined,
  };
}
