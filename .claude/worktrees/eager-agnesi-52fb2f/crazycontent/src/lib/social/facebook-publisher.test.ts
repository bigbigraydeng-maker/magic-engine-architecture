/**
 * Unit + Integration tests for facebook-publisher.ts
 * Covers: publishToFacebook, refreshFacebookToken, getFacebookPostMetrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  publishToFacebook,
  refreshFacebookToken,
  getFacebookPostMetrics,
  FacebookPublishInput,
} from './facebook-publisher';
import * as supabaseModule from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const BASE_INPUT: FacebookPublishInput = {
  projectId: 'proj-001',
  taskId: 'task-001',
  sourceId: 'src-001',
  caption: 'Test Facebook post',
  hashtags: ['#tech', '#AI'],
  imageUrl: 'https://example.com/image.jpg',
};

const CREDENTIALS = { accessToken: 'page-token-abc', pageId: 'page-123' };

/** Mock that returns source credentials successfully */
function credentialsQueryMock(metadata = CREDENTIALS) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'src-001', metadata },
      error: null,
    }),
  };
}

function logsInsertMock() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
}

// ---------------------------------------------------------------------------
// publishToFacebook
// ---------------------------------------------------------------------------

describe('publishToFacebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when Facebook source is not found', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
        } as any;
      }
      return logsInsertMock() as any;
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow();
  });

  it('throws when access token is missing', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return credentialsQueryMock({ pageId: 'page-123' } as any) as any; // no accessToken
      }
      return logsInsertMock() as any;
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow('Missing Facebook credentials');
  });

  it('throws when page ID is missing', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return credentialsQueryMock({ accessToken: 'token-abc' } as any) as any; // no pageId
      }
      return logsInsertMock() as any;
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow('Missing Facebook credentials');
  });

  it('throws when Facebook Graph API returns error response', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow('Invalid token');
  });

  it('throws when API response has no post ID', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // no id field
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow('No post ID');
  });

  it('publishes successfully and returns response shape', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return { insert: logsInsert } as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-post-xyz' }),
    });

    const result = await publishToFacebook(BASE_INPUT);

    expect(result.postId).toBe('fb-post-xyz');
    expect(result.pageId).toBe('page-123');
    expect(result.permalink).toContain('fb-post-xyz');
    expect(result.createdTime).toBeTruthy();
  });

  it('includes hashtags in the post content', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-hash-001' }),
    });

    await publishToFacebook(BASE_INPUT);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.message).toContain('#tech');
    expect(fetchBody.message).toContain('#AI');
  });

  it('includes image URL as link parameter when imageUrl provided', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-img-001' }),
    });

    await publishToFacebook(BASE_INPUT);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.link).toBe('https://example.com/image.jpg');
  });

  it('omits link parameter when imageUrl is not provided', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-noimg-001' }),
    });

    await publishToFacebook({ ...BASE_INPUT, imageUrl: undefined });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.link).toBeUndefined();
  });

  it('sets scheduled publish fields when scheduledTime is in the future', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-sched-001' }),
    });

    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    await publishToFacebook({ ...BASE_INPUT, scheduledTime: futureDate });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.published).toBe(false);
    expect(fetchBody.scheduled_publish_time).toBeTruthy();
    expect(result_scheduledTime(fetchBody.scheduled_publish_time, futureDate)).toBe(true);

    function result_scheduledTime(unix: number, date: Date) {
      return Math.abs(unix - Math.floor(date.getTime() / 1000)) <= 1;
    }
  });

  it('does not set scheduled publish when scheduledTime is in the past', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-past-001' }),
    });

    const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    await publishToFacebook({ ...BASE_INPUT, scheduledTime: pastDate });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.published).toBeUndefined();
  });

  it('logs success to generation_logs', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      if (table === 'generation_logs') return { insert: logsInsert } as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-log-001' }),
    });

    await publishToFacebook(BASE_INPUT);

    const logEntry = logsInsert.mock.calls[0][0][0];
    expect(logEntry.status).toBe('success');
    expect(logEntry.operation).toBe('publish_facebook');
    expect(logEntry.task_id).toBe(BASE_INPUT.taskId);
  });

  it('logs failure to generation_logs when publishing fails', async () => {
    const logsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
        } as any;
      }
      if (table === 'generation_logs') return { insert: logsInsert } as any;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await expect(publishToFacebook(BASE_INPUT)).rejects.toThrow();

    const logEntry = logsInsert.mock.calls[0][0][0];
    expect(logEntry.status).toBe('failed');
    expect(logEntry.error_message).toBeDefined();
  });

  it('handles empty hashtags array', async () => {
    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') return credentialsQueryMock() as any;
      return logsInsertMock() as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-nohash-001' }),
    });

    await publishToFacebook({ ...BASE_INPUT, hashtags: [] });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.message).toBe('Test Facebook post');
    // No newlines for empty hashtags
    expect(fetchBody.message).not.toContain('\n\n');
  });
});

// ---------------------------------------------------------------------------
// refreshFacebookToken
// ---------------------------------------------------------------------------

describe('refreshFacebookToken', () => {
  const SOURCE_ID = 'src-refresh-001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('FACEBOOK_APP_ID', 'app-id-123');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret-456');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('throws when source is not found', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
    } as any);

    await expect(refreshFacebookToken(SOURCE_ID)).rejects.toThrow('Facebook source not found');
  });

  it('throws when FACEBOOK_APP_ID env var is missing', async () => {
    delete process.env.FACEBOOK_APP_ID;

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { metadata: { accessToken: 'old-token' } },
        error: null,
      }),
    } as any);

    await expect(refreshFacebookToken(SOURCE_ID)).rejects.toThrow(
      'Missing Facebook app credentials'
    );
  });

  it('throws when FACEBOOK_APP_SECRET env var is missing', async () => {
    delete process.env.FACEBOOK_APP_SECRET;

    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { metadata: { accessToken: 'old-token' } },
        error: null,
      }),
    } as any);

    await expect(refreshFacebookToken(SOURCE_ID)).rejects.toThrow(
      'Missing Facebook app credentials'
    );
  });

  it('refreshes token and returns new access token', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { metadata: { accessToken: 'old-token-xyz' } },
      error: null,
    });
    const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });

    const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

    vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
      if (table === 'social_sources') {
        return {
          select: selectMock,
          update: updateMock,
        } as any;
      }
      return {} as any;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'new-token-999' }),
    });

    const newToken = await refreshFacebookToken(SOURCE_ID);

    expect(newToken).toBe('new-token-999');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ accessToken: 'new-token-999' }),
      })
    );
  });

  it('throws when API does not return access_token field', async () => {
    vi.mocked(supabaseModule.supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { metadata: { accessToken: 'old-token' } },
        error: null,
      }),
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // no access_token
    });

    await expect(refreshFacebookToken(SOURCE_ID)).rejects.toThrow('Failed to refresh token');
  });
});

// ---------------------------------------------------------------------------
// getFacebookPostMetrics
// ---------------------------------------------------------------------------

describe('getFacebookPostMetrics', () => {
  const POST_ID = 'fb-metrics-post-001';
  const ACCESS_TOKEN = 'metrics-token-xyz';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns metrics from successful API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        likes: { summary: { total_count: 55 } },
        comments: { summary: { total_count: 12 } },
        shares: { data: [{}, {}, {}] }, // 3 shares
      }),
    });

    const metrics = await getFacebookPostMetrics(POST_ID, ACCESS_TOKEN);

    expect(metrics.likes).toBe(55);
    expect(metrics.comments).toBe(12);
    expect(metrics.shares).toBe(3);
  });

  it('defaults to 0 for missing fields in API response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const metrics = await getFacebookPostMetrics(POST_ID, ACCESS_TOKEN);

    expect(metrics.likes).toBe(0);
    expect(metrics.comments).toBe(0);
    expect(metrics.shares).toBe(0);
  });

  it('throws when Facebook API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'OAuthException' } }),
    });

    await expect(getFacebookPostMetrics(POST_ID, ACCESS_TOKEN)).rejects.toThrow('OAuthException');
  });

  it('throws when fetch itself fails (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(getFacebookPostMetrics(POST_ID, ACCESS_TOKEN)).rejects.toThrow('Network timeout');
  });

  it('passes access token in the request URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await getFacebookPostMetrics(POST_ID, ACCESS_TOKEN);

    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(ACCESS_TOKEN);
    expect(calledUrl).toContain(POST_ID);
  });

  it('returns 0 shares when shares.data is empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        likes: { summary: { total_count: 10 } },
        comments: { summary: { total_count: 5 } },
        shares: { data: [] },
      }),
    });

    const metrics = await getFacebookPostMetrics(POST_ID, ACCESS_TOKEN);

    expect(metrics.shares).toBe(0);
  });
});
