/**
 * Integration tests for /api/crazy-content/generate endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import * as supabaseModule from '@/lib/supabase';
import * as topicsModule from '@/lib/db/topics';
import * as tasksModule from '@/lib/db/tasks';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  verifyProjectOwnership: vi.fn(),
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/db/topics', () => ({
  getTopics: vi.fn(),
}));

vi.mock('@/lib/db/tasks', () => ({
  createTask: vi.fn(),
}));

describe('POST /api/crazy-content/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(true);
  });

  it('should return 400 if project_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        topic_ids: ['topic-1'],
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('project_id');
  });

  it('should return 400 if topic_ids is not an array', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: 'topic-1', // string instead of array
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('topic_ids');
  });

  it('should return 400 if topic_ids is empty', async () => {
    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: [],
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('non-empty');
  });

  it('should return 400 if platforms contains invalid values', async () => {
    vi.mocked(topicsModule.getTopics).mockResolvedValue([
      { id: 'topic-1', name: 'AI Tips', keywords: ['ai'] } as any,
    ]);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['topic-1'],
        platforms: ['facebook', 'invalid_platform'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('Invalid platforms');
  });

  it('should return 403 if not project owner', async () => {
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(false);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['topic-1'],
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.message).toContain('Unauthorized');
  });

  it('should return 400 if topic_ids do not exist', async () => {
    vi.mocked(topicsModule.getTopics).mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['nonexistent-topic'],
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.message).toContain('Invalid topic IDs');
  });

  it('should create tasks for each topic + platform combination', async () => {
    const mockTopics = [
      { id: 'topic-1', name: 'AI Tips', keywords: ['ai'] } as any,
      { id: 'topic-2', name: 'Marketing', keywords: ['marketing'] } as any,
    ];

    const mockCreatedTasks = [
      { id: 'task-1', topic_id: 'topic-1', platforms: ['facebook'] } as any,
      { id: 'task-2', topic_id: 'topic-1', platforms: ['xiaohongshu'] } as any,
      { id: 'task-3', topic_id: 'topic-2', platforms: ['facebook'] } as any,
      { id: 'task-4', topic_id: 'topic-2', platforms: ['xiaohongshu'] } as any,
    ];

    vi.mocked(topicsModule.getTopics).mockResolvedValue(mockTopics);
    vi.mocked(tasksModule.createTask).mockResolvedValueOnce(mockCreatedTasks[0])
      .mockResolvedValueOnce(mockCreatedTasks[1])
      .mockResolvedValueOnce(mockCreatedTasks[2])
      .mockResolvedValueOnce(mockCreatedTasks[3]);

    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['topic-1', 'topic-2'],
        platforms: ['facebook', 'xiaohongshu'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.task_ids).toHaveLength(4);
    expect(json.data.task_count).toBe(4);
    expect(json.data.status).toBe('generating');
    expect(json.data.estimated_wait_ms).toBeGreaterThan(0);
  });

  it('should handle mixed success and failure when creating tasks', async () => {
    const mockTopics = [
      { id: 'topic-1', name: 'AI Tips', keywords: ['ai'] } as any,
    ];

    const mockCreatedTask = { id: 'task-1', topic_id: 'topic-1', platforms: ['facebook'] } as any;

    vi.mocked(topicsModule.getTopics).mockResolvedValue(mockTopics);
    vi.mocked(tasksModule.createTask).mockResolvedValueOnce(mockCreatedTask)
      .mockRejectedValueOnce(new Error('Duplicate task'));

    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['topic-1'],
        platforms: ['facebook', 'xiaohongshu'],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.task_ids).toHaveLength(1);
    expect(json.data.errors).toBeDefined();
    expect(json.data.errors.length).toBe(1);
  });

  it('should handle scheduled_at parameter', async () => {
    const mockTopics = [
      { id: 'topic-1', name: 'AI Tips', keywords: ['ai'] } as any,
    ];

    const mockCreatedTask = {
      id: 'task-1',
      topic_id: 'topic-1',
      platforms: ['facebook'],
      scheduled_at: '2026-04-07T10:00:00Z',
    } as any;

    vi.mocked(topicsModule.getTopics).mockResolvedValue(mockTopics);
    vi.mocked(tasksModule.createTask).mockResolvedValue(mockCreatedTask);

    const scheduledTime = new Date('2026-04-07T10:00:00Z').toISOString();
    const request = new NextRequest('http://localhost:3000/api/crazy-content/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'project-123',
        topic_ids: ['topic-1'],
        platforms: ['facebook'],
        scheduled_at: scheduledTime,
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(vi.mocked(tasksModule.createTask)).toHaveBeenCalledWith(
      'project-123',
      expect.objectContaining({
        scheduled_at: expect.any(Date),
      })
    );
  });
});
