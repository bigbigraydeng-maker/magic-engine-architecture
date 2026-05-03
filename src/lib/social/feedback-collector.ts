/**
 * Feedback Data Collector
 * Collects engagement metrics from published posts
 */

import { supabase } from '@/lib/supabase';

export interface PostFeedback {
  postId: string;
  platform: 'facebook' | 'xiaohongshu';
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  };
  sentiment?: string;
  topComments?: string[];
}

/**
 * Collect Facebook post metrics and store in database
 */
export async function collectFacebookFeedback(
  postId: string,
  sourceId: string,
  taskId: string,
  projectId: string
): Promise<PostFeedback> {
  console.log(`[Feedback] Collecting Facebook metrics for post ${postId}`);

  try {
    // Get Facebook credentials from source
    const { data: source, error } = await supabase
      .from('social_sources')
      .select('metadata')
      .eq('id', sourceId)
      .eq('platform', 'facebook')
      .single();

    if (error || !source) {
      throw new Error('Facebook source not found');
    }

    const metadata = source.metadata as any;
    const accessToken = metadata?.accessToken;

    if (!accessToken) {
      throw new Error('Missing Facebook access token');
    }

    // Fetch metrics from Facebook API
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${postId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`Facebook API error: ${response.statusText}`);
    }

    const data = await response.json();

    const feedback: PostFeedback = {
      postId,
      platform: 'facebook',
      metrics: {
        likes: data.likes?.summary?.total_count || 0,
        comments: data.comments?.summary?.total_count || 0,
        shares: data.shares?.data?.length || 0,
        views: 0, // Facebook doesn't provide view counts via public API
      },
    };

    // Store in collected_posts
    const { error: storeError } = await supabase
      .from('collected_posts')
      .insert([
        {
          source_id: sourceId,
          external_post_id: postId,
          platform: 'facebook',
          content: '',
          metrics: feedback.metrics,
          original_url: `https://facebook.com/${postId}`,
          collected_at: new Date().toISOString(),
        },
      ]);

    if (storeError) {
      throw storeError;
    }

    // Store feedback in feedback_data
    const { error: feedbackError } = await supabase
      .from('feedback_data')
      .insert([
        {
          project_id: projectId,
          task_id: taskId,
          source_id: sourceId,
          post_id: postId,
          platform: 'facebook',
          metrics: feedback.metrics,
          collected_at: new Date().toISOString(),
        },
      ]);

    if (feedbackError) {
      console.warn('[Feedback] Warning storing feedback:', feedbackError);
    }

    console.log(`[Feedback] Facebook metrics collected:`, feedback.metrics);
    return feedback;
  } catch (error) {
    console.error('[Feedback] Failed to collect Facebook feedback:', error);
    throw error;
  }
}

/**
 * Collect Xiaohongshu metrics (manual or via OCR)
 */
export async function collectXiaohongshuFeedback(
  uploadId: string,
  sourceId: string,
  taskId: string,
  projectId: string,
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  }
): Promise<PostFeedback> {
  console.log(`[Feedback] Recording Xiaohongshu metrics for upload ${uploadId}`);

  try {
    const feedback: PostFeedback = {
      postId: uploadId,
      platform: 'xiaohongshu',
      metrics,
    };

    // Store in collected_posts
    const { error: storeError } = await supabase
      .from('collected_posts')
      .insert([
        {
          source_id: sourceId,
          external_post_id: uploadId,
          platform: 'xiaohongshu',
          content: '',
          metrics: metrics,
          collected_at: new Date().toISOString(),
        },
      ]);

    if (storeError) {
      throw storeError;
    }

    // Store feedback in feedback_data
    const { error: feedbackError } = await supabase
      .from('feedback_data')
      .insert([
        {
          project_id: projectId,
          task_id: taskId,
          source_id: sourceId,
          post_id: uploadId,
          platform: 'xiaohongshu',
          metrics: metrics,
          collected_at: new Date().toISOString(),
        },
      ]);

    if (feedbackError) {
      console.warn('[Feedback] Warning storing feedback:', feedbackError);
    }

    console.log(`[Feedback] Xiaohongshu metrics recorded:`, metrics);
    return feedback;
  } catch (error) {
    console.error('[Feedback] Failed to record Xiaohongshu feedback:', error);
    throw error;
  }
}

/**
 * Calculate engagement score for feedback optimization
 */
export function calculateEngagementScore(metrics: {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}): number {
  if (metrics.views === 0) return 0;

  // Weight: shares (3x) > comments (2.5x) > likes (1x)
  const engagementValue =
    metrics.likes * 1 + metrics.comments * 2.5 + metrics.shares * 3;
  const score = (engagementValue / metrics.views) * 100;

  return Math.min(score, 100); // Cap at 100
}

/**
 * Collect all feedback for a project in a time window
 */
export async function collectProjectFeedback(
  projectId: string,
  daysBack: number = 7
): Promise<{
  totalPosts: number;
  totalEngagement: number;
  averageScore: number;
  topPosts: PostFeedback[];
  platformBreakdown: {
    facebook: { posts: number; engagement: number };
    xiaohongshu: { posts: number; engagement: number };
  };
}> {
  console.log(
    `[Feedback] Collecting project feedback for last ${daysBack} days`
  );

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const { data: posts, error } = await supabase
      .from('collected_posts')
      .select('*')
      .gte('collected_at', startDate.toISOString())
      .order('collected_at', { ascending: false });

    if (error) {
      throw error;
    }

    const postList = posts || [];
    let totalEngagement = 0;
    let facebookStats = { posts: 0, engagement: 0 };
    let xiaohongshuStats = { posts: 0, engagement: 0 };
    const scores: number[] = [];

    const topPosts: PostFeedback[] = [];

    for (const post of postList) {
      const metrics = post.metrics;
      const score = calculateEngagementScore(metrics);
      scores.push(score);

      const engagement = metrics.likes + metrics.comments * 2 + metrics.shares * 3;
      totalEngagement += engagement;

      const feedback: PostFeedback = {
        postId: post.id,
        platform: post.platform,
        metrics: metrics,
      };

      topPosts.push(feedback);

      if (post.platform === 'facebook') {
        facebookStats.posts++;
        facebookStats.engagement += engagement;
      } else if (post.platform === 'xiaohongshu') {
        xiaohongshuStats.posts++;
        xiaohongshuStats.engagement += engagement;
      }
    }

    // Sort by engagement and get top 5
    topPosts.sort((a, b) => {
      const scoreA = calculateEngagementScore(a.metrics);
      const scoreB = calculateEngagementScore(b.metrics);
      return scoreB - scoreA;
    });

    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b) / scores.length : 0;

    return {
      totalPosts: postList.length,
      totalEngagement: totalEngagement,
      averageScore: parseFloat(averageScore.toFixed(2)),
      topPosts: topPosts.slice(0, 5),
      platformBreakdown: {
        facebook: facebookStats,
        xiaohongshu: xiaohongshuStats,
      },
    };
  } catch (error) {
    console.error('[Feedback] Failed to collect project feedback:', error);
    throw error;
  }
}

/**
 * Get feedback for specific task
 */
export async function getTaskFeedback(
  taskId: string
): Promise<PostFeedback | null> {
  try {
    const { data, error } = await supabase
      .from('feedback_data')
      .select('*')
      .eq('task_id', taskId)
      .order('collected_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      postId: data.post_id,
      platform: data.platform,
      metrics: data.metrics,
    };
  } catch (error) {
    console.error('[Feedback] Failed to get task feedback:', error);
    return null;
  }
}
