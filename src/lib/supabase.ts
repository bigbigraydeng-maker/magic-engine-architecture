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
 * Verify project exists, auto-create if needed (server-side, no auth required)
 */
export async function verifyProjectOwnership(projectId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single();

  if (!error && data) return true;

  // Auto-create project if it doesn't exist (for initial setup)
  if (error?.code === 'PGRST116') {
    const { error: insertError } = await supabaseAdmin
      .from('projects')
      .insert([{
        id: projectId,
        user_id: '00000000-0000-0000-0000-000000000000',
        name: 'Default Project',
      }]);

    return !insertError;
  }

  return false;
}
