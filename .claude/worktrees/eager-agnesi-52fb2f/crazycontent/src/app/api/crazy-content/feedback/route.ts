/**
 * GET /api/crazy-content/feedback - Get feedback/engagement metrics
 * POST /api/crazy-content/feedback - Record feedback for a post
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleSupabaseError } from '@/lib/supabase';
import {
  collectFacebookFeedback,
  collectXiaohongshuFeedback,
  getTaskFeedback,
  collectProjectFeedback,
} from '@/lib/social/feedback-collector';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const taskId = searchParams.get('task_id');
    const daysBack = parseInt(searchParams.get('days_back') || '7');

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: { message: 'project_id is required' } },
        { status: 400 }
      );
    }

    let data;

    if (taskId) {
      // Get feedback for specific task
      const taskFeedback = await getTaskFeedback(taskId);
      if (!taskFeedback) {
        return NextResponse.json({
          success: true,
          data: null,
          message: 'No feedback data available for this task yet',
        });
      }
      data = taskFeedback;
    } else {
      // Get project-level feedback summary
      data = await collectProjectFeedback(projectId, daysBack);
    }

    return NextResponse.json({
      success: true,
      data: data,
      metadata: {
        projectId,
        taskId: taskId || undefined,
        daysBack: taskId ? undefined : daysBack,
      },
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
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
    const {
      project_id,
      task_id,
      source_id,
      post_id,
      platform,
      metrics,
    } = body;

    // Validate inputs
    if (!project_id || !task_id || !source_id || !post_id || !platform || !metrics) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message:
              'Missing required fields: project_id, task_id, source_id, post_id, platform, metrics',
          },
        },
        { status: 400 }
      );
    }

    // Validate platform
    if (!['facebook', 'xiaohongshu'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: { message: `Invalid platform: ${platform}` } },
        { status: 400 }
      );
    }

    // Validate metrics
    if (
      typeof metrics.likes !== 'number' ||
      typeof metrics.comments !== 'number' ||
      typeof metrics.shares !== 'number' ||
      typeof metrics.views !== 'number'
    ) {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid metrics format' } },
        { status: 400 }
      );
    }

    let feedback;

    try {
      if (platform === 'facebook') {
        feedback = await collectFacebookFeedback(
          post_id,
          source_id,
          task_id,
          project_id
        );
      } else if (platform === 'xiaohongshu') {
        feedback = await collectXiaohongshuFeedback(
          post_id,
          source_id,
          task_id,
          project_id,
          metrics
        );
      }

      return NextResponse.json({
        success: true,
        data: feedback,
        message: 'Feedback recorded successfully',
      });
    } catch (collectError) {
      console.error('Error collecting feedback:', collectError);
      return NextResponse.json(
        {
          success: false,
          error: {
            message:
              collectError instanceof Error
                ? collectError.message
                : 'Failed to collect feedback',
          },
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing feedback:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
