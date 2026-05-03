import { apiFetch } from './client';

interface GenerateResult {
  task_ids: string[];
  task_count: number;
  status: string;
  estimated_wait_ms: number;
  errors?: Array<{ topic_id: string; error: string }>;
}

export function generateContent(input: {
  project_id: string;
  topic_ids: string[];
  platforms: string[];
}) {
  return apiFetch<GenerateResult>('generate', {
    method: 'POST',
    body: input,
  });
}
