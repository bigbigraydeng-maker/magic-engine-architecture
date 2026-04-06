/**
 * GET /api/crazy-content/topics - List content topics
 * POST /api/crazy-content/topics - Create new topic
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopics, createTopic } from '@/lib/db/topics';
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

    const items = await getTopics(projectId);

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  } catch (error) {
    console.error('Error fetching topics:', error);
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
      name,
      description,
      keywords,
      target_audience,
      tone,
      frequency_daily,
    } = body;

    if (!project_id || !name || !keywords) {
      return NextResponse.json(
        { success: false, error: { message: 'Missing required fields: project_id, name, keywords' } },
        { status: 400 }
      );
    }

    const topic = await createTopic(project_id, {
      name,
      description,
      keywords,
      target_audience,
      tone,
      frequency_daily,
    });

    return NextResponse.json(
      {
        success: true,
        data: topic,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating topic:', error);
    const err = handleSupabaseError(error);
    const statusCode = err.message.includes('Unauthorized') ? 403 : err.message.includes('Invalid') ? 400 : 500;
    return NextResponse.json(
      { success: false, error: err },
      { status: statusCode }
    );
  }
}
