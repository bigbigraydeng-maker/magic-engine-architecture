/**
 * Integration tests for POST /api/crazy-content/publish
 * and GET /api/crazy-content/publish (health check)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import * as tasksModule from '@/lib/db/tasks';
import * as facebookModule from '@/lib/social/facebook-publisher';
import * as xiaohongshuModule from '@/lib/social/xiaohongshu-publisher';
import * as supabaseModule from '@/lib/supabase';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/tasks', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/lib/social/facebook-publisher', () => ({
  publishToFacebook: vi.fn(),
}));

vi.mock('@/lib/social/xiaohongshu-publisher', () => ({
  publishToXiaohongshu: vi.fn(),
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

function makePostRequest(body: Record<string, any>): NextRequest {
  return new NextRequest('http://localhost:3000/api/crazy-content/publish', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/crazy-content/publish', {
    method: 'GET',
  });
}

const MOCK_TASK_FACEBOOK = {
  id: 'task-001',
  project_id: 'proj-001',
  source_id: 'src-001',
  image_url: 'https://example.com/img.jpg',
  scheduled_at: undefined,
  generated_captions: {
    facebook: {
      zh: '这是测试内容',
      hashtags: '#测试 #内容',
    },
  },
};

const MOCK_TASK_XIAOHONGSHU = {
  id: 'task-002',
  project_id: 'proj-001',
  source_id: 'src-001',
  image_url: 'https://example.com/img.jpg',
  scheduled_at: undefined,
  generated_captions: {
    xiaohongshu: {
      zh: '小红书测试内容',
      hashtags: '#小红书 #测试',
    },
  },
};

// ---------------------------------------------------------------------------
// GET – health check
// ---------------------------------------------------------------------------

describe('GET /api/crazy-content/publish', () => {
  it('returns 200 with success message', async () => {
    const response = await GET(makeGetRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST – input validation
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/publish – validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when project_id is missing', async () => {
    const response = await POST(makePostRequest({ task_id: 'task-001', platform: 'facebook' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('project_id');
  });

  it('returns 400 when task_id is missing', async () => {
    const response = await POST(makePostRequest({ project_id: 'proj-001', platform: 'facebook' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('task_id');
  });

  it('returns 400 when platform is missing', async () => {
    const response = await POST(makePostRequest({ project_id: 'proj-001', task_id: 'task-001' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('platform');
  });

  it('returns 400 when platform is invalid', async () => {
    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'twitter' })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('twitter');
  });

  it('accepts facebook as a valid platform', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(null);

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );
    // Gets past validation (404 because task not found, not 400)
    expect(response.status).toBe(404);
  });

  it('accepts xiaohongshu as a valid platform', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(null);

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'xiaohongshu' })
    );
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST – task lookup
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/publish – task lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when task is not found', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(null);

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'nonexistent', platform: 'facebook' })
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.message).toContain('Task not found');
  });

  it('returns 400 when no generated captions exist for platform', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue({
      ...MOCK_TASK_FACEBOOK,
      generated_captions: null,
    } as any);

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('No generated captions');
  });

  it('returns 400 when captions for the specific platform are missing', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue({
      ...MOCK_TASK_FACEBOOK,
      generated_captions: { xiaohongshu: { zh: '内容' } },
    } as any);

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('facebook');
  });
});

// ---------------------------------------------------------------------------
// POST – Facebook publishing
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/publish – Facebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes to Facebook successfully', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-post-999',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-post-999',
    });

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('facebook');
    expect(json.data.postId).toBe('fb-post-999');
    expect(json.data.status).toBe('published');
  });

  it('calls updateTask with publishing status before publishing', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-post-999',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-post-999',
    });

    await POST(makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' }));

    const firstUpdateCall = vi.mocked(tasksModule.updateTask).mock.calls[0];
    expect(firstUpdateCall[2]).toMatchObject({ status: 'publishing' });
  });

  it('calls updateTask with published status after success', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-post-999',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-post-999',
    });

    await POST(makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' }));

    const lastUpdateCall =
      vi.mocked(tasksModule.updateTask).mock.calls[
        vi.mocked(tasksModule.updateTask).mock.calls.length - 1
      ];
    expect(lastUpdateCall[2]).toMatchObject({ status: 'published' });
  });

  it('marks task as failed when Facebook publishing throws', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockRejectedValue(
      new Error('Facebook API unavailable')
    );

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );

    expect(response.status).toBe(500);
    const failCalls = vi
      .mocked(tasksModule.updateTask)
      .mock.calls.filter(([, , update]) => update.status === 'failed');
    expect(failCalls.length).toBeGreaterThan(0);
  });

  it('passes caption and hashtags to publishToFacebook', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-post-999',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-post-999',
    });

    await POST(makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' }));

    const callArg = vi.mocked(facebookModule.publishToFacebook).mock.calls[0][0];
    expect(callArg.caption).toBe('这是测试内容');
    expect(callArg.hashtags).toContain('#测试');
  });

  it('uses en caption when zh is absent', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue({
      ...MOCK_TASK_FACEBOOK,
      generated_captions: {
        facebook: { en: 'English caption', hashtags: '#test' },
      },
    } as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-999',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-999',
    });

    await POST(makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' }));

    const callArg = vi.mocked(facebookModule.publishToFacebook).mock.calls[0][0];
    expect(callArg.caption).toBe('English caption');
  });
});

// ---------------------------------------------------------------------------
// POST – Xiaohongshu publishing
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/publish – Xiaohongshu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes to Xiaohongshu successfully', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_XIAOHONGSHU as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(xiaohongshuModule.publishToXiaohongshu).mockResolvedValue({
      postId: 'xhs_upload_001',
      status: 'prepared',
      formattedContent: '小红书测试内容\n\n#小红书 #测试\n\n👇 你的看法是什么？',
      instructions: 'Upload instructions here',
    });

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-002', platform: 'xiaohongshu' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('xiaohongshu');
    expect(json.data.postId).toBe('xhs_upload_001');
    expect(json.data.instructions).toBeTruthy();
  });

  it('marks task as failed when Xiaohongshu publishing throws', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_XIAOHONGSHU as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(xiaohongshuModule.publishToXiaohongshu).mockRejectedValue(
      new Error('Account not found')
    );

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-002', platform: 'xiaohongshu' })
    );

    expect(response.status).toBe(500);
    const failCalls = vi
      .mocked(tasksModule.updateTask)
      .mock.calls.filter(([, , update]) => update.status === 'failed');
    expect(failCalls.length).toBeGreaterThan(0);
    const failUpdate = failCalls[0][2];
    expect(failUpdate.error_message).toContain('Account not found');
  });
});

// ---------------------------------------------------------------------------
// POST – error handling
// ---------------------------------------------------------------------------

describe('POST /api/crazy-content/publish – error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 500 when an unexpected error occurs', async () => {
    vi.mocked(tasksModule.getTask).mockRejectedValue(new Error('Unexpected DB error'));

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  it('returns 403 for Unauthorized errors', async () => {
    vi.mocked(tasksModule.getTask).mockRejectedValue(new Error('Unauthorized access'));
    vi.mocked(supabaseModule.handleSupabaseError).mockReturnValue({
      message: 'Unauthorized access',
    });

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );

    expect(response.status).toBe(403);
  });

  it('returns timestamp in successful response', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(MOCK_TASK_FACEBOOK as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(facebookModule.publishToFacebook).mockResolvedValue({
      postId: 'fb-ts-001',
      pageId: 'page-001',
      createdTime: new Date().toISOString(),
      permalink: 'https://facebook.com/fb-ts-001',
    });

    const response = await POST(
      makePostRequest({ project_id: 'proj-001', task_id: 'task-001', platform: 'facebook' })
    );
    const json = await response.json();

    expect(json.data.timestamp).toBeTruthy();
    expect(new Date(json.data.timestamp).toString()).not.toBe('Invalid Date');
  });
});
