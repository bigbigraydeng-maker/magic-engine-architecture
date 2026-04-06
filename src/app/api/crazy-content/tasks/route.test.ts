/**
 * Integration tests for /api/crazy-content/tasks endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import * as tasksModule from '@/lib/db/tasks';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/tasks', () => ({
  getTasks: vi.fn(),
  createTask: vi.fn(),
}));

describe('POST /api/crazy-content/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks', {
      method: 'GET',
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id is required');
  });

  it('should fetch tasks with pagination', async () => {
    const mockResult = {
      items: [
        {
          id: 'task-1',
          project_id: 'project-123',
          status: 'pending',
          platforms: ['facebook'],
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      total: 1,
    };

    vi.mocked(tasksModule.getTasks).mockResolvedValue(mockResult);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks?project_id=project-123&limit=10&offset=0',
      {
        method: 'GET',
      }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.items).toHaveLength(1);
    expect(json.metadata.limit).toBe(10);
  });

  it('should return 400 if platforms is missing in POST', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        // missing platforms
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('platforms');
  });

  it('should return 400 if platforms is empty array', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platforms: [],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('non-empty array');
  });

  it('should create task with valid input', async () => {
    const mockCreatedTask = {
      id: 'task-123',
      project_id: 'project-123',
      topic_id: 'topic-1',
      platforms: ['facebook', 'xiaohongshu'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.createTask).mockResolvedValue(mockCreatedTask);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_id: 'topic-1',
        platforms: ['facebook', 'xiaohongshu'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.platforms).toContain('facebook');
  });

  it('should return 403 on authorization error', async () => {
    vi.mocked(tasksModule.createTask).mockRejectedValue(
      new Error('Unauthorized')
    );

    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
  });
});
