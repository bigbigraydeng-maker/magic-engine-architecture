/**
 * Integration tests for /api/crazy-content/sources endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import * as sourcesModule from '@/lib/db/sources';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/sources', () => ({
  getSources: vi.fn(),
  createSource: vi.fn(),
}));

describe('POST /api/crazy-content/sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/sources', {
      method: 'GET',
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id is required');
  });

  it('should fetch sources for a project', async () => {
    const mockSources = [
      {
        id: 'source-1',
        project_id: 'project-123',
        platform: 'facebook',
        account_id: 'fb-123',
        account_name: 'CEO Account',
        api_token: 'token-xyz',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    vi.mocked(sourcesModule.getSources).mockResolvedValue(mockSources);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/sources?project_id=project-123',
      {
        method: 'GET',
      }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.items[0].platform).toBe('facebook');
  });

  it('should return 400 if required fields are missing in POST', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/sources', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platform: 'facebook',
        // missing account_id and api_token
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('required fields');
  });

  it('should create source with valid input', async () => {
    const mockCreatedSource = {
      id: 'source-123',
      project_id: 'project-123',
      platform: 'xiaohongshu',
      account_id: 'xhs-account-1',
      account_name: 'Red Account',
      api_token: 'xhs-token',
      token_expires_at: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(sourcesModule.createSource).mockResolvedValue(mockCreatedSource);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/sources', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platform: 'xiaohongshu',
        account_id: 'xhs-account-1',
        account_name: 'Red Account',
        api_token: 'xhs-token',
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('xiaohongshu');
  });

  it('should handle duplicate account error with 400 status', async () => {
    vi.mocked(sourcesModule.createSource).mockRejectedValue(
      new Error('Account already connected')
    );

    const request = new NextRequest('http://localhost:3000/api/crazy-content/sources', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platform: 'facebook',
        account_id: 'fb-123',
        api_token: 'token',
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('should return 403 on authorization error', async () => {
    vi.mocked(sourcesModule.createSource).mockRejectedValue(
      new Error('Unauthorized')
    );

    const request = new NextRequest('http://localhost:3000/api/crazy-content/sources', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platform: 'facebook',
        account_id: 'fb-123',
        api_token: 'token',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
  });
});
