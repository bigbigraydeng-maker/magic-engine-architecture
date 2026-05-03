/**
 * GET /api/crazy-content/tasks - List content tasks
 * POST /api/crazy-content/tasks - Create content task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTasks, createTask } from '@/lib/db/tasks';
import { handleSupabaseError } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const status = searchParams.get('status') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: { message: 'project_id is required' } },
        { status: 400 }
      );
    }

    const { items, total } = await getTasks(projectId, { status, limit, offset });

    return NextResponse.json({
      success: true,
      data: {
        items,
        total,
      },
      metadata: { limit, offset },
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
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
    const { project_id, topic_id, platforms, scheduled_at } = body;

    if (!project_id || !platforms) {
      return NextResponse.json(
        { success: false, error: { message: 'Missing required fields: project_id, platforms' } },
        { status: 400 }
      );
    }

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'platforms must be a non-empty array' } },
        { status: 400 }
      );
    }

    const task = await createTask(project_id, {
      topic_id,
      platforms,
      scheduled_at: scheduled_at ? new Date(scheduled_at) : undefined,
    });

    return NextResponse.json(
      {
        success: true,
        data: task,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating task:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized')
      ? 403
      : err.message.includes('Invalid') || err.message.includes('not found')
        ? 400
        : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
