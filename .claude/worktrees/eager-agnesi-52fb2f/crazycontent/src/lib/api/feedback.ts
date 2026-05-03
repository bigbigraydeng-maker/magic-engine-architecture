import { apiFetch } from './client';

interface FeedbackSummary {
  totalPosts: number;
  totalEngagement: number;
  averageScore: number;
  topPosts: Array<{
    id: string;
    content: string;
    platform: string;
    metrics: { likes: number; comments: number; shares: number; views: number };
    collected_at: string;
  }>;
  platformBreakdown: {
    facebook: { posts: number; engagement: number };
    xiaohongshu: { posts: number; engagement: number };
  };
}

export function fetchFeedback(projectId: string, daysBack: number = 7) {
  return apiFetch<FeedbackSummary>('feedback', {
    params: {
      project_id: projectId,
      days_back: String(daysBack),
    },
  });
}
