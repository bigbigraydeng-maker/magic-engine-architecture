/**
 * Typed API client for CrazyContent endpoints
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

export async function apiFetch<T>(
  path: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  }
): Promise<T> {
  const { method = 'GET', body, params } = options || {};

  let url = `/api/crazy-content/${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json: ApiResponse<T> = await res.json();

  if (!json.success || !res.ok) {
    throw new ApiError(
      json.error?.message || `Request failed with status ${res.status}`,
      res.status,
      json.error?.code
    );
  }

  return json.data as T;
}
