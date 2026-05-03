/**
 * GET /api/crazy-content/images - Search Unsplash images
 * POST /api/crazy-content/images - Track download + attach to task
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchImages, searchImagesForTopic, trackDownload } from '@/lib/images/unsplash';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const topic = searchParams.get('topic');
    const keywords = searchParams.get('keywords');
    const platform = searchParams.get('platform') as 'facebook' | 'xiaohongshu' | null;

    if (topic && keywords) {
      const images = await searchImagesForTopic(
        topic,
        keywords.split(','),
        platform || 'facebook'
      );
      return NextResponse.json({ success: true, data: images });
    }

    if (!query) {
      return NextResponse.json(
        { success: false, error: { message: 'query or topic+keywords required' } },
        { status: 400 }
      );
    }

    const images = await searchImages(query, {
      perPage: 6,
      orientation: platform === 'xiaohongshu' ? 'portrait' : 'landscape',
    });

    return NextResponse.json({ success: true, data: images });
  } catch (error) {
    console.error('Image search error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Image search failed' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { task_id, project_id, image_url, download_url, photographer, photographer_url } = await request.json();

    if (!task_id || !project_id || !image_url) {
      return NextResponse.json(
        { success: false, error: { message: 'task_id, project_id, image_url required' } },
        { status: 400 }
      );
    }

    // Track download per Unsplash API guidelines
    if (download_url) {
      await trackDownload(download_url);
    }

    // Update task with selected image
    const { data, error } = await supabaseAdmin
      .from('content_tasks')
      .update({
        image_url,
        image_metadata: {
          source: 'unsplash',
          photographer,
          photographer_url,
          selected_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', task_id)
      .eq('project_id', project_id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update task: ${error.message}`);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Image attach error:', error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : 'Failed' } },
      { status: 500 }
    );
  }
}
