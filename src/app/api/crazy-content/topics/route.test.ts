/**
 * Integration tests for /api/crazy-content/topics endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import * as topicsModule from '@/lib/db/topics';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/topics', () => ({
  getTopics: vi.fn(),
  createTopic: vi.fn(),
}));

describe('POST /api/crazy-content/topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/topics', {
      method: 'GET',
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('project_id is required');
  });

  it('should fetch topics with valid project_id', async () => {
    const mockTopics = [
      {
        id: 'topic-1',
        name: 'AI Tips',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    vi.mocked(topicsModule.getTopics).mockResolvedValue(mockTopics);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/topics?project_id=project-123',
      {
        method: 'GET',
      }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.total).toBe(1);
  });

  it('should return 400 if required POST fields are missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/topics', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        name: 'AI Tips',
        // missing keywords
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('should create topic with valid input', async () => {
    const mockCreatedTopic = {
      id: 'topic-123',
      project_id: 'project-123',
      name: 'AI Marketing',
      keywords: ['ai', 'marketing'],
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(topicsModule.createTopic).mockResolvedValue(mockCreatedTopic);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/topics', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        name: 'AI Marketing',
        keywords: ['ai', 'marketing'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('topic-123');
  });

  it('should return 403 on authorization error', async () => {
    vi.mocked(topicsModule.createTopic).mockRejectedValue(
      new Error('Unauthorized')
    );

    const request = new NextRequest('http://localhost:3000/api/crazy-content/topics', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        name: 'AI Marketing',
        keywords: ['ai', 'marketing'],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
  });
});
