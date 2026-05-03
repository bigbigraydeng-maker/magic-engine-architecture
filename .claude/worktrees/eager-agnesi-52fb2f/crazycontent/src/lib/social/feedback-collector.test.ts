/**
 * Unit + Integration tests for feedback-collector.ts
 * Covers: collectFacebookFeedback, collectXiaohongshuFeedback,
 *         calculateEngagementScore, collectProjectFeedback, getTaskFeedback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectFacebookFeedback,
  collectXiaohongshuFeedback,
  calculateEngagementScore,
  collectProjectFeedback,
  getTaskFeedback,
} from './feedback-collector';
import * as supabaseModule from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// We need to mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// calculateEngagementScore – pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('calculateEngagementScore', () => {
  it('returns 0 when views is 0', () => {
    expect(calculateEngagementScore({ likes: 100, comments: 50, shares: 20, views: 0 })).toBe(0);
  });

  it('calculates score correctly with normal values', () => {
    // score = (100*1 + 50*2.5 + 20*3) / 1000 * 100 = (100+125+60)/1000*100 = 28.5
    const score = calculateEngagementScore({ likes: 100, comments: 50, shares: 20, views: 1000 });
    expect(score).toBeCloseTo(28.5, 5);
  });

  it('caps score at 100', () => {
    // Extremely high engagement relative to views
    const score = calculateEngagementScore({ likes: 9999, comments: 9999, shares: 9999, views: 1 });
    expect(score).toBe(100);
  });

  it('returns 0 for all-zero metrics except views', () => {
    const score = calculateEngagementScore({ likes: 0, comments: 0, shares: 0, views: 500 });
    expect(score).toBe(0);
  });

  it('weights shares (3x) > comments (2.5x) > likes (1x)', () => {
    const byLikes = calculateEngagementScore({ likes: 30, comments: 0, shares: 0, views: 100 });
    const byComments = calculateEngagementScore({ likes: 0, comments: 30, shares: 0, views: 100 });
    const byShares = calculateEngagementScore({ likes: 0, comments: 0, shares: 30, views: 100 });
    expect(byShares).toBeGreaterThan(byComments);
    expect(byComments).toBeGreaterThan(byLikes);
  });

  it('handles fractional views', () => {
    // Should not throw
    expect(() =>
      calculateEngagementScore({ likes: 1, comments: 1, shares: 1, views: 0.5 })
    ).not.toThrow();
  });

  it('handles very large numbers without overflow', () => {
    const score = calculateEngagementScore({
      likes: 1_000_000,
      comments: 500_000,
      shares: 200_000,
      views: 10_000_000,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// collectFacebookFeedback
// ---------------------------------------------------------------------------

describe('collectFacebookFeedback', () => {
  const POST_ID = 'fb-post-123';
  const SOURCE_ID = 'source-abc';
  const TASK_ID = 'task-xyz';
  const PROJECT_ID = 'project-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when Facebook source is not found', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
    } as any);

    await expect(
      collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID)
    ).rejects.toThrow('Facebook source not found');
  });

  it('throws when access token is missing from metadata', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { metadata: {} }, // no accessToken
        error: null,
      }),
    } as any);

    await expect(
      collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID)
    ).rejects.toThrow('Missing Facebook access token');
  });

  it('throws when Facebook API returns non-ok response', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { metadata: { accessToken: 'tok-123' } },
        error: null,
      }),
    } as any);

    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Forbidden' });

    await expect(
      collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID)
    ).rejects.toThrow('Facebook API error');
  });

  it('collects metrics successfully and stores them', async () => {
    // First call: select source
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { metadata: { accessToken: 'tok-abc' } },
            error: null,
          }),
        } as any;
      }
      // collected_posts and feedback_data
      return { insert: insertMock } as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        likes: { summary: { total_count: 42 } },
        comments: { summary: { total_count: 7 } },
        shares: { data: [{}, {}] }, // 2 shares
      }),
    });

    const result = await collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID);

    expect(result.postId).toBe(POST_ID);
    expect(result.platform).toBe('facebook');
    expect(result.metrics.likes).toBe(42);
    expect(result.metrics.comments).toBe(7);
    expect(result.metrics.shares).toBe(2);
    expect(result.metrics.views).toBe(0); // Facebook public API doesn't provide views
    expect(insertMock).toHaveBeenCalledTimes(2); // collected_posts + feedback_data
  });

  it('defaults to 0 for missing API fields', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { metadata: { accessToken: 'tok-abc' } },
            error: null,
          }),
        } as any;
      }
      return { insert: insertMock } as any;
    });

    // Response with no likes/comments/shares fields
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID);

    expect(result.metrics.likes).toBe(0);
    expect(result.metrics.comments).toBe(0);
    expect(result.metrics.shares).toBe(0);
  });

  it('still returns feedback even when feedback_data insert warns', async () => {
    const insertMock = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null }) // collected_posts OK
      .mockResolvedValueOnce({ data: null, error: new Error('warn') }); // feedback_data WARN

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { metadata: { accessToken: 'tok-abc' } },
            error: null,
          }),
        } as any;
      }
      return { insert: insertMock } as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ likes: { summary: { total_count: 5 } } }),
    });

    const result = await collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID);
    expect(result.metrics.likes).toBe(5); // still succeeds
  });

  it('throws when collected_posts insert fails', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { metadata: { accessToken: 'tok' } },
            error: null,
          }),
        } as any;
      }
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: new Error('DB write failed') }),
      } as any;
    });

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await expect(
      collectFacebookFeedback(POST_ID, SOURCE_ID, TASK_ID, PROJECT_ID)
    ).rejects.toThrow('DB write failed');
  });
});

// ---------------------------------------------------------------------------
// collectXiaohongshuFeedback
// ---------------------------------------------------------------------------

describe('collectXiaohongshuFeedback', () => {
  const UPLOAD_ID = 'xhs-upload-001';
  const SOURCE_ID = 'src-001';
  const TASK_ID = 'task-001';
  const PROJECT_ID = 'proj-001';
  const METRICS = { likes: 100, comments: 20, shares: 5, views: 2000 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores metrics and returns PostFeedback', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({ insert: insertMock } as any);

    const result = await collectXiaohongshuFeedback(
      UPLOAD_ID,
      SOURCE_ID,
      TASK_ID,
      PROJECT_ID,
      METRICS
    );

    expect(result.postId).toBe(UPLOAD_ID);
    expect(result.platform).toBe('xiaohongshu');
    expect(result.metrics).toEqual(METRICS);
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it('throws when collected_posts insert fails', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: new Error('write error') }),
    } as any);

    await expect(
      collectXiaohongshuFeedback(UPLOAD_ID, SOURCE_ID, TASK_ID, PROJECT_ID, METRICS)
    ).rejects.toThrow('write error');
  });

  it('still succeeds when feedback_data insert warns', async () => {
    const insertMock = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null }) // collected_posts OK
      .mockResolvedValueOnce({ data: null, error: new Error('warn only') }); // feedback_data WARN

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({ insert: insertMock } as any);

    const result = await collectXiaohongshuFeedback(
      UPLOAD_ID,
      SOURCE_ID,
      TASK_ID,
      PROJECT_ID,
      METRICS
    );

    expect(result.postId).toBe(UPLOAD_ID);
  });

  it('handles zero-value metrics', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({ insert: insertMock } as any);

    const zeroMetrics = { likes: 0, comments: 0, shares: 0, views: 0 };
    const result = await collectXiaohongshuFeedback(
      UPLOAD_ID,
      SOURCE_ID,
      TASK_ID,
      PROJECT_ID,
      zeroMetrics
    );

    expect(result.metrics).toEqual(zeroMetrics);
  });
});

// ---------------------------------------------------------------------------
// collectProjectFeedback
// ---------------------------------------------------------------------------

describe('collectProjectFeedback', () => {
  const PROJECT_ID = 'proj-abc';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty summary when no posts exist', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    const result = await collectProjectFeedback(PROJECT_ID);

    expect(result.totalPosts).toBe(0);
    expect(result.totalEngagement).toBe(0);
    expect(result.averageScore).toBe(0);
    expect(result.topPosts).toHaveLength(0);
    expect(result.platformBreakdown.facebook.posts).toBe(0);
    expect(result.platformBreakdown.xiaohongshu.posts).toBe(0);
  });

  it('aggregates mixed-platform posts correctly', async () => {
    const posts = [
      {
        id: 'p1',
        platform: 'facebook',
        metrics: { likes: 10, comments: 5, shares: 2, views: 100 },
      },
      {
        id: 'p2',
        platform: 'xiaohongshu',
        metrics: { likes: 20, comments: 10, shares: 3, views: 200 },
      },
      {
        id: 'p3',
        platform: 'facebook',
        metrics: { likes: 5, comments: 2, shares: 1, views: 50 },
      },
    ];

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: posts, error: null }),
    } as any);

    const result = await collectProjectFeedback(PROJECT_ID);

    expect(result.totalPosts).toBe(3);
    expect(result.platformBreakdown.facebook.posts).toBe(2);
    expect(result.platformBreakdown.xiaohongshu.posts).toBe(1);
    // Top posts should not exceed 5
    expect(result.topPosts.length).toBeLessThanOrEqual(5);
  });

  it('returns at most 5 top posts even with more data', async () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({
      id: `post-${i}`,
      platform: 'facebook',
      metrics: { likes: i * 10, comments: i * 5, shares: i * 2, views: 500 },
    }));

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: posts, error: null }),
    } as any);

    const result = await collectProjectFeedback(PROJECT_ID);

    expect(result.topPosts).toHaveLength(5);
  });

  it('sorts topPosts by engagement score descending', async () => {
    const posts = [
      { id: 'low', platform: 'facebook', metrics: { likes: 1, comments: 0, shares: 0, views: 100 } },
      { id: 'high', platform: 'facebook', metrics: { likes: 50, comments: 20, shares: 10, views: 100 } },
      { id: 'mid', platform: 'facebook', metrics: { likes: 10, comments: 5, shares: 2, views: 100 } },
    ];

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: posts, error: null }),
    } as any);

    const result = await collectProjectFeedback(PROJECT_ID);

    const scores = result.topPosts.map((p) => calculateEngagementScore(p.metrics));
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });

  it('respects daysBack parameter', async () => {
    const gtesMock = vi.fn().mockReturnThis();
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: gtesMock,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    await collectProjectFeedback(PROJECT_ID, 14);

    expect(gtesMock).toHaveBeenCalledTimes(1);
    const [, dateArg] = gtesMock.mock.calls[0];
    const daysAgo = (Date.now() - new Date(dateArg).getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAgo).toBeCloseTo(14, 0);
  });

  it('throws when Supabase query fails', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    } as any);

    await expect(collectProjectFeedback(PROJECT_ID)).rejects.toThrow('DB error');
  });

  it('uses default of 7 days when daysBack is not provided', async () => {
    const gtesMock = vi.fn().mockReturnThis();
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: gtesMock,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    await collectProjectFeedback(PROJECT_ID);

    const [, dateArg] = gtesMock.mock.calls[0];
    const daysAgo = (Date.now() - new Date(dateArg).getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAgo).toBeCloseTo(7, 0);
  });

  it('averageScore is rounded to 2 decimal places', async () => {
    const posts = [
      { id: 'p1', platform: 'facebook', metrics: { likes: 1, comments: 1, shares: 1, views: 3 } },
    ];

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: posts, error: null }),
    } as any);

    const result = await collectProjectFeedback(PROJECT_ID);
    const decimalPart = result.averageScore.toString().split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// getTaskFeedback
// ---------------------------------------------------------------------------

describe('getTaskFeedback', () => {
  const TASK_ID = 'task-feed-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns PostFeedback when task feedback exists', async () => {
    const mockData = {
      post_id: 'post-123',
      platform: 'facebook',
      metrics: { likes: 10, comments: 3, shares: 1, views: 100 },
    };

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    } as any);

    const result = await getTaskFeedback(TASK_ID);

    expect(result).not.toBeNull();
    expect(result!.postId).toBe('post-123');
    expect(result!.platform).toBe('facebook');
    expect(result!.metrics).toEqual(mockData.metrics);
  });

  it('returns null when no feedback found', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    } as any);

    const result = await getTaskFeedback(TASK_ID);

    expect(result).toBeNull();
  });

  it('returns null on unexpected database error (does not throw)', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockRejectedValue(new Error('connection timeout')),
    } as any);

    const result = await getTaskFeedback(TASK_ID);

    expect(result).toBeNull();
  });

  it('maps xiaohongshu platform correctly', async () => {
    const mockData = {
      post_id: 'xhs-001',
      platform: 'xiaohongshu',
      metrics: { likes: 50, comments: 10, shares: 5, views: 800 },
    };

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    } as any);

    const result = await getTaskFeedback(TASK_ID);

    expect(result!.platform).toBe('xiaohongshu');
  });
});
