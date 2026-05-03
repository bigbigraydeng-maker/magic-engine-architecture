/**
 * GET /api/crazy-content/sources - List connected social media accounts
 * POST /api/crazy-content/sources - Connect new social media account
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSources, createSource } from '@/lib/db/sources';
import { handleSupabaseError } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: { message: 'project_id is required' } },
        { status: 400 }
      );
    }

    const items = await getSources(projectId);

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, platform, account_id, account_name, api_token, token_expires_at } = body;

    if (!project_id || !platform || !account_id || !api_token) {
      return NextResponse.json(
        {
          success: false,
          error: { message: 'Missing required fields: project_id, platform, account_id, api_token' },
        },
        { status: 400 }
      );
    }

    // TODO: Implement OAuth flow to exchange oauth_code for api_token
    // For now, expecting the client to provide the api_token directly

    const source = await createSource(project_id, {
      platform,
      account_id,
      account_name,
      api_token,
      token_expires_at: token_expires_at ? new Date(token_expires_at) : undefined,
    });

    return NextResponse.json(
      {
        success: true,
        data: source,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error connecting source:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized')
      ? 403
      : err.message.includes('Invalid') || err.message.includes('already')
        ? 400
        : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
