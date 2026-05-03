/**
 * Supabase client initialization and utilities
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// Public client (for client-side, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client (for server-side API routes, bypasses RLS)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabase;

/**
 * Helper function to handle Supabase errors
 */
export function handleSupabaseError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: 'Unknown error occurred' };
}

/**
 * Verify project access (placeholder - no auth system yet, always allows)
 * TODO: Add proper auth when user login is implemented
 */
export async function verifyProjectOwnership(_projectId: string): Promise<boolean> {
  return true;
}

/**
 * Ensure default project exists in the database
 */
export async function ensureDefaultProject(projectId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('projects')
    .upsert([{
      id: projectId,
      user_id: '00000000-0000-0000-0000-000000000000',
      name: 'Default Project',
    }], { onConflict: 'id' });

  if (error) {
    console.warn('Failed to ensure default project:', error.message);
  }
}
