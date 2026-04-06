/**
 * Integration tests for /api/crazy-content/tasks/[id] endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';
import * as tasksModule from '@/lib/db/tasks';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/tasks', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
}));

describe('GET /api/crazy-content/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks/task-123', {
      method: 'GET',
    });

    const response = await GET(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id is required');
  });

  it('should fetch a single task', async () => {
    const mockTask = {
      id: 'task-123',
      project_id: 'project-123',
      platforms: ['facebook'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.getTask).mockResolvedValue(mockTask);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('task-123');
  });

  it('should return 404 if task not found', async () => {
    vi.mocked(tasksModule.getTask).mockResolvedValue(null);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/nonexistent?project_id=project-123',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, { params: { id: 'nonexistent' } });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.message).toContain('not found');
  });

  it('should return 403 on authorization error', async () => {
    vi.mocked(tasksModule.getTask).mockRejectedValue(new Error('Unauthorized'));

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, { params: { id: 'task-123' } });

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/crazy-content/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/tasks/task-123', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });

    const response = await PATCH(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id is required');
  });

  it('should update task status', async () => {
    const mockUpdatedTask = {
      id: 'task-123',
      project_id: 'project-123',
      status: 'completed',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.updateTask).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }
    );

    const response = await PATCH(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('completed');
  });

  it('should reject invalid status', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'invalid_status' }),
      }
    );

    const response = await PATCH(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('Invalid status');
  });

  it('should update task with generated content', async () => {
    const mockUpdatedTask = {
      id: 'task-123',
      project_id: 'project-123',
      status: 'completed',
      generated_captions: {
        facebook: { zh: 'AI创业必看', en: 'AI Tips for Entrepreneurs' },
        xiaohongshu: { zh: '小红书文案', en: 'Red Caption' },
      },
      image_url: 'https://example.com/image.jpg',
      published_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.updateTask).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'completed',
          generated_captions: mockUpdatedTask.generated_captions,
          image_url: 'https://example.com/image.jpg',
          published_at: new Date().toISOString(),
        }),
      }
    );

    const response = await PATCH(request, { params: { id: 'task-123' } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.status).toBe('completed');
    expect(json.data.generated_captions).toBeDefined();
  });

  it('should return 404 if task not found', async () => {
    vi.mocked(tasksModule.updateTask).mockRejectedValue(new Error('Task not found'));

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/nonexistent?project_id=project-123',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }
    );

    const response = await PATCH(request, { params: { id: 'nonexistent' } });

    expect(response.status).toBe(404);
  });

  it('should return 403 on authorization error', async () => {
    vi.mocked(tasksModule.updateTask).mockRejectedValue(new Error('Unauthorized'));

    const request = new NextRequest(
      'http://localhost:3000/api/crazy-content/tasks/task-123?project_id=project-123',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }
    );

    const response = await PATCH(request, { params: { id: 'task-123' } });

    expect(response.status).toBe(403);
  });
});
