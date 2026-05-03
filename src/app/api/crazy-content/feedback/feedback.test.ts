/**
 * Integration tests for GET and POST /api/crazy-content/feedback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import * as feedbackModule from '@/lib/social/feedback-collector';
import * as supabaseModule from '@/lib/supabase';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/social/feedback-collector', () => ({
  collectFacebookFeedback: vi.fn(),
  collectXiaohongshuFeedback: vi.fn(),
  getTaskFeedback: vi.fn(),
  collectProjectFeedback: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  handleSupabaseError: vi.fn((err: unknown) => ({
    message: err instanceof Error ? err.message : 'Unknown error occurred',
  })),
  supabase: { from: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/crazy-content/feedback');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: Record<string, any>): NextRequest {
  return new NextRequest('http://localhost:3000/api/crazy-content/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const VALID_METRICS = { likes: 100, comments: 20, shares: 5, views: 1000 };

const VALID_POST_BODY = {
  project_id: 'proj-001',
  task_id: 'task-001',
  source_id: 'src-001',
  post_id: 'post-abc',
  platform: 'facebook',
  metrics: VALID_METRICS,
};

// ---------------------------------------------------------------------------
// GET – input validation
// ---------------------------------------------------------------------------

describe('GET /api/crazy-content/feedback – validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when project_id is missing', async () => {
    const response = await GET(makeGetRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('project_id');
  });
});

// ---------------------------------------------------------------------------
// GET – project-level feedback
// ---------------------------------------------------------------------------

describe('GET /api/crazy-content/feedback – project summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns project feedback when only project_id provided', async () => {
    const mockSummary = {
      totalPosts: 10,
      totalEngagement: 500,
      averageScore: 12.5,
      topPosts: [],
      platformBreakdown: {
        facebook: { posts: 6, engagement: 300 },
        xiaohongshu: { posts: 4, engagement: 200 },
      },
    };

    vi.mocked(feedbackModule.collectProjectFeedback).mockResolvedValue(mockSummary);

    const response = await GET(makeGetRequest({ project_id: 'proj-001' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.totalPosts).toBe(10);
    expect(json.data.averageScore).toBe(12.5);
    expect(json.metadata.projectId).toBe('proj-001');
  });

  it('uses default 7 days when days_back is not provided', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockResolvedValue({
      totalPosts: 0,
      totalEngagement: 0,
      averageScore: 0,
      topPosts: [],
      platformBreakdown: {
        facebook: { posts: 0, engagement: 0 },
        xiaohongshu: { posts: 0, engagement: 0 },
      },
    });

    await GET(makeGetRequest({ project_id: 'proj-001' }));

    expect(feedbackModule.collectProjectFeedback).toHaveBeenCalledWith('proj-001', 7);
  });

  it('passes days_back parameter to collectProjectFeedback', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockResolvedValue({
      totalPosts: 0,
      totalEngagement: 0,
      averageScore: 0,
      topPosts: [],
      platformBreakdown: {
        facebook: { posts: 0, engagement: 0 },
        xiaohongshu: { posts: 0, engagement: 0 },
      },
    });

    await GET(makeGetRequest({ project_id: 'proj-001', days_back: '30' }));

    expect(feedbackModule.collectProjectFeedback).toHaveBeenCalledWith('proj-001', 30);
  });

  it('includes metadata in response', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockResolvedValue({
      totalPosts: 5,
      totalEngagement: 100,
      averageScore: 5.0,
      topPosts: [],
      platformBreakdown: {
        facebook: { posts: 5, engagement: 100 },
        xiaohongshu: { posts: 0, engagement: 0 },
      },
    });

    const response = await GET(makeGetRequest({ project_id: 'proj-abc', days_back: '14' }));
    const json = await response.json();

    expect(json.metadata.projectId).toBe('proj-abc');
    expect(json.metadata.daysBack).toBe(14);
    expect(json.metadata.taskId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET – task-level feedback
// ---------------------------------------------------------------------------

describe('GET /api/crazy-content/feedback – task feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns task feedback when task_id is provided', async () => {
    const mockFeedback = {
      postId: 'post-task-001',
      platform: 'facebook' as const,
      metrics: VALID_METRICS,
    };

    vi.mocked(feedbackModule.getTaskFeedback).mockResolvedValue(mockFeedback);

    const response = await GET(
      makeGetRequest({ project_id: 'proj-001', task_id: 'task-001' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.postId).toBe('post-task-001');
    expect(json.data.platform).toBe('facebook');
  });

  it('returns success with null data when no task feedback exists', async () => {
    vi.mocked(feedbackModule.getTaskFeedback).mockResolvedValue(null);

    const response = await GET(
      makeGetRequest({ project_id: 'proj-001', task_id: 'task-no-data' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
    expect(json.message).toContain('No feedback');
  });

  it('does not call collectProjectFeedback when task_id is provided', async () => {
    vi.mocked(feedbackModule.getTaskFeedback).mockResolvedValue(null);

    await GET(makeGetRequest({ project_id: 'proj-001', task_id: 'task-001' }));

    expect(feedbackModule.collectProjectFeedback).not.toHaveBeenCalled();
  });

  it('does not call getTaskFeedback when task_id is absent', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockResolvedValue({
      totalPosts: 0,
      totalEngagement: 0,
      averageScore: 0,
      topPosts: [],
      platformBreakdown: {
        facebook: { posts: 0, engagement: 0 },
        xiaohongshu: { posts: 0, engagement: 0 },
      },
    });

    await GET(makeGetRequest({ project_id: 'proj-001' }));

    expect(feedbackModule.getTaskFeedback).not.toHaveBeenCalled();
  });

  it('metadata excludes daysBack for task-level requests when task has data', async () => {
    vi.mocked(feedbackModule.getTaskFeedback).mockResolvedValue({
      postId: 'post-001',
      platform: 'facebook',
      metrics: VALID_METRICS,
    });

    const response = await GET(
      makeGetRequest({ project_id: 'proj-001', task_id: 'task-001' })
    );
    const json = await response.json();

    // metadata is only present in the success path that goes through the shared return
    expect(json.metadata.daysBack).toBeUndefined();
    expect(json.metadata.taskId).toBe('task-001');
  });
});

// ---------------------------------------------------------------------------
// GET – error handling
// ---------------------------------------------------------------------------

describe('GET /api/crazy-content/feedback – error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 500 on unexpected error from collectProjectFeedback', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockRejectedValue(
      new Error('DB connection failed')
    );

    const response = await GET(makeGetRequest({ project_id: 'proj-001' }));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  it('returns 403 when Unauthorized error occurs', async () => {
    vi.mocked(feedbackModule.collectProjectFeedback).mockRejectedValue(
      new Error('Unauthorized access')
    );
    vi.mocked(supabaseModule.handleSupabaseError).mockReturnValue({
      message: 'Unauthorized',
    });

    const response = await GET(makeGetRequest({ project_id: 'proj-001' }));

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST – input validation
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/feedback – validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when project_id is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).project_id;
    const response = await POST(makePostRequest(body));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id');
  });

  it('returns 400 when task_id is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).task_id;
    const response = await POST(makePostRequest(body));
    expect(response.status).toBe(400);
  });

  it('returns 400 when source_id is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).source_id;
    const response = await POST(makePostRequest(body));
    expect(response.status).toBe(400);
  });

  it('returns 400 when post_id is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).post_id;
    const response = await POST(makePostRequest(body));
    expect(response.status).toBe(400);
  });

  it('returns 400 when platform is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).platform;
    const response = await POST(makePostRequest(body));
    expect(response.status).toBe(400);
  });

  it('returns 400 when metrics is missing', async () => {
    const body = { ...VALID_POST_BODY };
    delete (body as any).metrics;
    const response = await POST(makePostRequest(body));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid platform', async () => {
    const response = await POST(makePostRequest({ ...VALID_POST_BODY, platform: 'tiktok' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('tiktok');
  });

  it('returns 400 when metrics.likes is not a number', async () => {
    const response = await POST(
      makePostRequest({ ...VALID_POST_BODY, metrics: { ...VALID_METRICS, likes: 'many' } })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('Invalid metrics');
  });

  it('returns 400 when metrics.comments is not a number', async () => {
    const response = await POST(
      makePostRequest({ ...VALID_POST_BODY, metrics: { ...VALID_METRICS, comments: null } })
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when metrics.shares is not a number', async () => {
    const response = await POST(
      makePostRequest({ ...VALID_POST_BODY, metrics: { ...VALID_METRICS, shares: '5' } })
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when metrics.views is not a number', async () => {
    const response = await POST(
      makePostRequest({ ...VALID_POST_BODY, metrics: { ...VALID_METRICS, views: true } })
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST – Facebook feedback collection
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/feedback – Facebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects Facebook feedback successfully', async () => {
    const mockFeedback = {
      postId: 'fb-post-abc',
      platform: 'facebook' as const,
      metrics: VALID_METRICS,
    };

    vi.mocked(feedbackModule.collectFacebookFeedback).mockResolvedValue(mockFeedback);

    const response = await POST(makePostRequest(VALID_POST_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.postId).toBe('fb-post-abc');
    expect(json.message).toContain('Feedback recorded');
  });

  it('calls collectFacebookFeedback with correct parameters', async () => {
    vi.mocked(feedbackModule.collectFacebookFeedback).mockResolvedValue({
      postId: 'fb-post-abc',
      platform: 'facebook',
      metrics: VALID_METRICS,
    });

    const testPostId = 'post-abc'; // Independent of VALID_POST_BODY
    const testBody = {
      project_id: 'proj-001',
      task_id: 'task-001',
      source_id: 'src-001',
      post_id: testPostId,
      platform: 'facebook',
      metrics: VALID_METRICS,
    };

    await POST(makePostRequest(testBody));

    expect(feedbackModule.collectFacebookFeedback).toHaveBeenCalledWith(
      testPostId,
      'src-001',
      'task-001',
      'proj-001'
    );
  });

  it('returns 500 when collectFacebookFeedback throws', async () => {
    vi.mocked(feedbackModule.collectFacebookFeedback).mockRejectedValue(
      new Error('Facebook API error')
    );

    const response = await POST(makePostRequest(VALID_POST_BODY));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('Facebook API error');
  });
});

// ---------------------------------------------------------------------------
// POST – Xiaohongshu feedback collection
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/feedback – Xiaohongshu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects Xiaohongshu feedback successfully', async () => {
    const mockFeedback = {
      postId: 'xhs-post-001',
      platform: 'xiaohongshu' as const,
      metrics: VALID_METRICS,
    };

    vi.mocked(feedbackModule.collectXiaohongshuFeedback).mockResolvedValue(mockFeedback);

    const body = { ...VALID_POST_BODY, platform: 'xiaohongshu' };
    const response = await POST(makePostRequest(body));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('xiaohongshu');
  });

  it('calls collectXiaohongshuFeedback with metrics argument', async () => {
    vi.mocked(feedbackModule.collectXiaohongshuFeedback).mockResolvedValue({
      postId: 'post-xhs',
      platform: 'xiaohongshu',
      metrics: VALID_METRICS,
    });

    const testPostId = 'post-abc'; // Independent of VALID_POST_BODY
    const body = {
      project_id: 'proj-001',
      task_id: 'task-001',
      source_id: 'src-001',
      post_id: testPostId,
      platform: 'xiaohongshu',
      metrics: VALID_METRICS,
    };
    await POST(makePostRequest(body));

    expect(feedbackModule.collectXiaohongshuFeedback).toHaveBeenCalledWith(
      testPostId,
      'src-001',
      'task-001',
      'proj-001',
      VALID_METRICS
    );
  });

  it('does not call collectFacebookFeedback for xiaohongshu platform', async () => {
    vi.mocked(feedbackModule.collectXiaohongshuFeedback).mockResolvedValue({
      postId: 'post-xhs',
      platform: 'xiaohongshu',
      metrics: VALID_METRICS,
    });

    await POST(makePostRequest({ ...VALID_POST_BODY, platform: 'xiaohongshu' }));

    expect(feedbackModule.collectFacebookFeedback).not.toHaveBeenCalled();
  });

  it('returns 500 when collectXiaohongshuFeedback throws', async () => {
    vi.mocked(feedbackModule.collectXiaohongshuFeedback).mockRejectedValue(
      new Error('Storage failed')
    );

    const response = await POST(
      makePostRequest({ ...VALID_POST_BODY, platform: 'xiaohongshu' })
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error.message).toContain('Storage failed');
  });
});

// ---------------------------------------------------------------------------
// POST – outer error handling
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/feedback – outer error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns non-200 status on malformed JSON body', async () => {
    // The outer catch will call handleSupabaseError; the exact status depends on
    // whether the mock returns "Unauthorized" in the message.
    // We reset the mock to return a generic message so we get 500.
    vi.mocked(supabaseModule.handleSupabaseError).mockReturnValueOnce({
      message: 'JSON parse error',
    });

    const request = new NextRequest('http://localhost:3000/api/crazy-content/feedback', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);

    expect([400, 500]).toContain(response.status);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  it('returns 403 for Unauthorized outer error', async () => {
    vi.mocked(supabaseModule.handleSupabaseError).mockReturnValue({
      message: 'Unauthorized',
    });

    // Force outer catch by making request.json() throw
    const badRequest = {
      json: () => { throw new Error('Unauthorized access'); },
    } as unknown as NextRequest;

    const response = await POST(badRequest);
    expect(response.status).toBe(403);
  });
});
