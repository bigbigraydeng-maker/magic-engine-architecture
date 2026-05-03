import { apiFetch } from './client';

interface PublishResult {
  task_id: string;
  platform: string;
  status: string;
  postId: string;
  timestamp: string;
  instructions?: string;
}

export function publishContent(input: {
  project_id: string;
  task_id: string;
  platform: string;
}) {
  return apiFetch<PublishResult>('publish', {
    method: 'POST',
    body: input,
  });
}
