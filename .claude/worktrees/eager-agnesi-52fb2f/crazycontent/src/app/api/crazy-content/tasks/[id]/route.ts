/**
 * GET /api/crazy-content/tasks/[id] - Get single task
 * PATCH /api/crazy-content/tasks/[id] - Update task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTask, updateTask } from '@/lib/db/tasks';
import { handleSupabaseError } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: { message: 'project_id is required' } },
        { status: 400 }
      );
    }

    const task = await getTask(projectId, params.id);

    if (!task) {
      return NextResponse.json(
        { success: false, error: { message: 'Task not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: { message: 'project_id is required' } },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { status, generated_captions, image_url, scheduled_at, published_at, error_message } = body;

    // Validate status if provided
    if (status) {
      const validStatuses = ['pending', 'generating', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` } },
          { status: 400 }
        );
      }
    }

    const task = await updateTask(projectId, params.id, {
      status,
      generated_captions,
      image_url,
      scheduled_at: scheduled_at ? new Date(scheduled_at) : undefined,
      published_at: published_at ? new Date(published_at) : undefined,
      error_message,
    });

    return NextResponse.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Error updating task:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized')
      ? 403
      : err.message.includes('not found')
        ? 404
        : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
