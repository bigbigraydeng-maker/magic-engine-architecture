/**
 * POST /api/crazy-content/publish - Publish generated content to social media
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTask, updateTask } from '@/lib/db/tasks';
import { handleSupabaseError } from '@/lib/supabase';
import { publishToFacebook } from '@/lib/social/facebook-publisher';
import { publishToXiaohongshu } from '@/lib/social/xiaohongshu-publisher';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, task_id, platform } = body;

    // Validate inputs
    if (!project_id || !task_id || !platform) {
      return NextResponse.json(
        {
          success: false,
          error: { message: 'Missing required fields: project_id, task_id, platform' },
        },
        { status: 400 }
      );
    }

    // Validate platform
    const validPlatforms = ['facebook', 'xiaohongshu'];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { success: false, error: { message: `Invalid platform: ${platform}` } },
        { status: 400 }
      );
    }

    // Get task details
    const task = await getTask(project_id, task_id);
    if (!task) {
      return NextResponse.json(
        { success: false, error: { message: 'Task not found' } },
        { status: 404 }
      );
    }

    // Check if task has generated content
    if (!task.generated_captions || !task.generated_captions[platform]) {
      return NextResponse.json(
        { success: false, error: { message: `No generated captions for ${platform}` } },
        { status: 400 }
      );
    }

    // Get the caption and hashtags for this platform
    const platformCaptions = task.generated_captions[platform];
    const caption = platformCaptions.zh || platformCaptions.en || '';
    const hashtags = platformCaptions.hashtags?.split(' ') || [];

    // Mark task as publishing
    await updateTask(project_id, task_id, {
      status: 'publishing',
    });

    let result;

    try {
      if (platform === 'facebook') {
        // Publish to Facebook
        result = await publishToFacebook({
          projectId: project_id,
          taskId: task_id,
          sourceId: task.source_id || '', // Would need to be in task
          caption: caption,
          hashtags: hashtags,
          imageUrl: task.image_url,
          scheduledTime: task.scheduled_at,
        });

        // Update task with post ID
        await updateTask(project_id, task_id, {
          status: 'published',
          published_at: new Date(),
        });
      } else if (platform === 'xiaohongshu') {
        // Publish to Xiaohongshu
        result = await publishToXiaohongshu({
          projectId: project_id,
          taskId: task_id,
          sourceId: task.source_id || '', // Would need to be in task
          caption: caption,
          hashtags: hashtags,
          imageUrl: task.image_url,
          scheduledTime: task.scheduled_at,
        });

        // Update task with upload ID
        await updateTask(project_id, task_id, {
          status: 'published',
          published_at: new Date(),
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          task_id: task_id,
          platform: platform,
          status: 'published',
          postId: result.postId,
          timestamp: new Date().toISOString(),
          instructions: result.instructions,
        },
      });
    } catch (publishError) {
      // Mark task as failed
      await updateTask(project_id, task_id, {
        status: 'failed',
        error_message:
          publishError instanceof Error ? publishError.message : 'Publishing failed',
      });

      throw publishError;
    }
  } catch (error) {
    console.error('Error publishing content:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}

// Health check
export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Publish endpoint is available',
  });
}
