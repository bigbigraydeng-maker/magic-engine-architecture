import { apiFetch } from './client';
import { ContentTopic } from '@/types/crazy-content';

export function fetchTopics(projectId: string) {
  return apiFetch<{ items: ContentTopic[]; total: number }>('topics', {
    params: { project_id: projectId },
  });
}

export function createTopic(
  projectId: string,
  input: {
    name: string;
    description?: string;
    keywords: string[];
    target_audience?: string;
    tone?: string;
    frequency_daily?: number;
  }
) {
  return apiFetch<ContentTopic>('topics', {
    method: 'POST',
    body: { project_id: projectId, ...input },
  });
}
