import { apiFetch } from './client';
import { ContentTask } from '@/types/crazy-content';

export function fetchTasks(
  projectId: string,
  options?: { status?: string; limit?: number; offset?: number }
) {
  const params: Record<string, string> = { project_id: projectId };
  if (options?.status) params.status = options.status;
  if (options?.limit) params.limit = String(options.limit);
  if (options?.offset) params.offset = String(options.offset);

  return apiFetch<{ items: ContentTask[]; total: number }>('tasks', { params });
}

export function fetchTask(projectId: string, taskId: string) {
  return apiFetch<ContentTask>(`tasks/${taskId}`, {
    params: { project_id: projectId },
  });
}

export function createTask(
  projectId: string,
  input: {
    topic_id?: string;
    platforms: string[];
    scheduled_at?: string;
  }
) {
  return apiFetch<ContentTask>('tasks', {
    method: 'POST',
    body: { project_id: projectId, ...input },
  });
}
