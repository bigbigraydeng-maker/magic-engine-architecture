/**
 * POST /api/crazy-content/generate - Trigger content generation
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyProjectOwnership } from '@/lib/supabase';
import { getTopics } from '@/lib/db/topics';
import { createTask } from '@/lib/db/tasks';
import { handleSupabaseError } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, topic_ids, platforms, image_option, scheduled_at } = body;

    if (!project_id || !topic_ids || !platforms) {
      return NextResponse.json(
        { success: false, error: { message: 'Missing required fields: project_id, topic_ids, platforms' } },
        { status: 400 }
      );
    }

    // Validate arrays
    if (!Array.isArray(topic_ids) || topic_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'topic_ids must be a non-empty array' } },
        { status: 400 }
      );
    }

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'platforms must be a non-empty array' } },
        { status: 400 }
      );
    }

    // Validate platforms
    const validPlatforms = ['facebook', 'xiaohongshu'];
    const invalidPlatforms = platforms.filter(
      (p: string) => !validPlatforms.includes(p)
    );
    if (invalidPlatforms.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: { message: `Invalid platforms: ${invalidPlatforms.join(', ')}` },
        },
        { status: 400 }
      );
    }

    // Verify project ownership
    const isOwner = await verifyProjectOwnership(project_id);
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 403 }
      );
    }

    // Get all topics for the project to validate topic_ids
    const allTopics = await getTopics(project_id);
    const validTopicIds = new Set(allTopics.map((t) => t.id));
    const invalidTopicIds = topic_ids.filter((id: string) => !validTopicIds.has(id));

    if (invalidTopicIds.length > 0) {
      return NextResponse.json(
        { success: false, error: { message: `Invalid topic IDs: ${invalidTopicIds.join(', ')}` } },
        { status: 400 }
      );
    }

    // Create tasks for each topic + platform combination
    const createdTasks = [];
    const creationErrors = [];

    for (const topic_id of topic_ids) {
      for (const platform of platforms) {
        try {
          const task = await createTask(project_id, {
            topic_id,
            platforms: [platform],
            scheduled_at: scheduled_at ? new Date(scheduled_at) : undefined,
          });
          createdTasks.push(task);
        } catch (error) {
          creationErrors.push({
            topic_id,
            platform,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    if (createdTasks.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Failed to create any generation tasks',
            details: creationErrors,
          },
        },
        { status: 500 }
      );
    }

    // Calculate estimated wait time based on number of tasks
    // Assume ~1 second per task + 2 seconds overhead
    const estimatedWaitMs = (createdTasks.length * 1000) + 2000;

    return NextResponse.json({
      success: true,
      data: {
        task_ids: createdTasks.map((t) => t.id),
        task_count: createdTasks.length,
        status: 'generating',
        estimated_wait_ms: estimatedWaitMs,
        errors: creationErrors.length > 0 ? creationErrors : undefined,
      },
    });
  } catch (error) {
    console.error('Error generating content:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
