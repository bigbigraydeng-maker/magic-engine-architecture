/**
 * Tests for Task Processing Cron Endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import * as tasksModule from '@/lib/db/tasks';
import * as topicsModule from '@/lib/db/topics';
import * as logsModule from '@/lib/db/logs';
import * as generateModule from '@/lib/ai/generate';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/tasks', () => ({
  getPendingTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/lib/db/topics', () => ({
  getTopics: vi.fn(),
}));

vi.mock('@/lib/db/logs', () => ({
  logGeneration: vi.fn(),
}));

vi.mock('@/lib/ai/generate', () => ({
  generateCaptions: vi.fn(),
  generateCaptionsMock: vi.fn(),
}));

describe('POST /api/cron/process-tasks', () => {
  const mockCronSecret = 'test-cron-secret';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = mockCronSecret;
    process.env.ENABLE_REAL_GENERATION = 'false';
  });

  it('should return 401 if cron secret is invalid', async () => {
    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid-secret',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it('should process zero tasks gracefully', async () => {
    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.processed).toBe(0);
  });

  it('should process pending tasks', async () => {
    const mockTask = {
      id: 'task-1',
      project_id: 'project-123',
      topic_id: 'topic-1',
      platforms: ['facebook'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockTopic = {
      id: 'topic-1',
      project_id: 'project-123',
      name: 'AI Tips',
      keywords: ['ai', 'tips'],
      tone: 'professional' as const,
      target_audience: 'Entrepreneurs',
      frequency_daily: 1,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockGenerationResult = {
      captions: ['Test caption 1', 'Test caption 2', 'Test caption 3'],
      hashtags: ['#ai', '#tips'],
      cost_usd: 0.001,
      tokens_used: 150,
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([mockTask]);
    vi.mocked(topicsModule.getTopics).mockResolvedValue([mockTopic]);
    vi.mocked(generateModule.generateCaptionsMock).mockResolvedValue(mockGenerationResult);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({
      ...mockTask,
      status: 'completed',
    } as any);
    vi.mocked(logsModule.logGeneration).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.processed).toBe(1);
    expect(json.data.failed).toBe(0);
    expect(json.data.totalCost).toBeCloseTo(0.001, 4);
  });

  it('should handle tasks without topic_id', async () => {
    const mockTask = {
      id: 'task-1',
      project_id: 'project-123',
      topic_id: undefined,
      platforms: ['facebook'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([mockTask] as any);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.processed).toBe(0);
    expect(json.data.failed).toBe(1);
  });

  it('should handle multiple platforms', async () => {
    const mockTask = {
      id: 'task-1',
      project_id: 'project-123',
      topic_id: 'topic-1',
      platforms: ['facebook', 'xiaohongshu'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockTopic = {
      id: 'topic-1',
      project_id: 'project-123',
      name: 'AI Tips',
      keywords: ['ai'],
      tone: 'professional' as const,
      target_audience: 'Entrepreneurs',
      frequency_daily: 1,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockGenerationResult = {
      captions: ['Caption 1'],
      hashtags: ['#ai'],
      cost_usd: 0.001,
      tokens_used: 150,
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([mockTask]);
    vi.mocked(topicsModule.getTopics).mockResolvedValue([mockTopic]);
    vi.mocked(generateModule.generateCaptionsMock).mockResolvedValue(mockGenerationResult);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(logsModule.logGeneration).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.processed).toBe(1);
    expect(vi.mocked(generateModule.generateCaptionsMock)).toHaveBeenCalledTimes(2); // Once per platform
  });

  it('should mark tasks as failed on error', async () => {
    const mockTask = {
      id: 'task-1',
      project_id: 'project-123',
      topic_id: 'topic-1',
      platforms: ['facebook'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([mockTask]);
    vi.mocked(topicsModule.getTopics).mockRejectedValue(new Error('Database error'));
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(logsModule.logGeneration).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.failed).toBeGreaterThan(0);
    expect(vi.mocked(tasksModule.updateTask)).toHaveBeenCalledWith(
      'project-123',
      'task-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('should log generation operations', async () => {
    const mockTask = {
      id: 'task-1',
      project_id: 'project-123',
      topic_id: 'topic-1',
      platforms: ['facebook'],
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockTopic = {
      id: 'topic-1',
      project_id: 'project-123',
      name: 'AI Tips',
      keywords: ['ai'],
      tone: 'professional' as const,
      target_audience: 'Entrepreneurs',
      frequency_daily: 1,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockGenerationResult = {
      captions: ['Test caption'],
      hashtags: ['#ai'],
      cost_usd: 0.001,
      tokens_used: 150,
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue([mockTask]);
    vi.mocked(topicsModule.getTopics).mockResolvedValue([mockTopic]);
    vi.mocked(generateModule.generateCaptionsMock).mockResolvedValue(mockGenerationResult);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(logsModule.logGeneration).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(vi.mocked(logsModule.logGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'project-123',
        task_id: 'task-1',
        operation: 'generate_copy',
        status: 'success',
        cost_usd: expect.any(Number),
      })
    );
  });

  it('should accumulate total cost', async () => {
    const mockTasks = [
      {
        id: 'task-1',
        project_id: 'project-123',
        topic_id: 'topic-1',
        platforms: ['facebook'],
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'task-2',
        project_id: 'project-123',
        topic_id: 'topic-1',
        platforms: ['facebook'],
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const mockTopic = {
      id: 'topic-1',
      project_id: 'project-123',
      name: 'AI Tips',
      keywords: ['ai'],
      tone: 'professional' as const,
      target_audience: 'Entrepreneurs',
      frequency_daily: 1,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockGenerationResult = {
      captions: ['Caption'],
      hashtags: ['#ai'],
      cost_usd: 0.002,
      tokens_used: 150,
    };

    vi.mocked(tasksModule.getPendingTasks).mockResolvedValue(mockTasks);
    vi.mocked(topicsModule.getTopics).mockResolvedValue([mockTopic]);
    vi.mocked(generateModule.generateCaptionsMock).mockResolvedValue(mockGenerationResult);
    vi.mocked(tasksModule.updateTask).mockResolvedValue({} as any);
    vi.mocked(logsModule.logGeneration).mockResolvedValue({} as any);

    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mockCronSecret}`,
      },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.totalCost).toBeCloseTo(0.004, 4); // 0.002 * 2 tasks
  });
});

describe('GET /api/cron/process-tasks', () => {
  it('should return health check response', async () => {
    const request = new NextRequest('http://localhost:3000/api/cron/process-tasks', {
      method: 'GET',
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('running');
    expect(json.timestamp).toBeDefined();
  });
});
