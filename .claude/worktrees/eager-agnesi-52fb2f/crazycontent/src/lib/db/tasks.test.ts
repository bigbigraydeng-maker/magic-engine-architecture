/**
 * Tests for Content Tasks Database Operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTask, getTasks, createTask, updateTask, getPendingTasks } from './tasks';
import * as supabaseModule from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
  verifyProjectOwnership: vi.fn(),
}));

describe('Tasks Database Operations', () => {
  const mockProjectId = 'project-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(true);
  });

  describe('getTask', () => {
    it('should fetch a single task by ID', async () => {
      const taskId = 'task-123';
      const mockTask = {
        id: taskId,
        project_id: mockProjectId,
        topic_id: 'topic-1',
        platforms: ['facebook', 'xiaohongshu'],
        status: 'pending',
        generated_captions: null,
        image_url: null,
        scheduled_at: null,
        published_at: null,
        error_message: null,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockTask, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getTask(mockProjectId, taskId);

      expect(result?.id).toBe(taskId);
      expect(result?.status).toBe('pending');
    });

    it('should return null if task not found', async () => {
      const taskId = 'nonexistent';

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getTask(mockProjectId, taskId);

      expect(result).toBeNull();
    });
  });

  describe('getTasks', () => {
    it('should fetch tasks with pagination', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          project_id: mockProjectId,
          status: 'pending',
          created_at: '2026-04-06T00:00:00Z',
          updated_at: '2026-04-06T00:00:00Z',
          platforms: ['facebook'],
        },
      ];

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: mockTasks, error: null, count: 1 }),
        select: vi.fn().mockReturnThis(),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getTasks(mockProjectId, { limit: 10, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter tasks by status', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
        select: vi.fn().mockReturnThis(),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getTasks(mockProjectId, { status: 'completed' });

      expect(result.items).toHaveLength(0);
      expect(mockQuery.eq).toHaveBeenCalledWith('status', 'completed');
    });
  });

  describe('createTask', () => {
    it('should create a new task', async () => {
      const mockCreatedTask = {
        id: 'task-123',
        project_id: mockProjectId,
        topic_id: 'topic-1',
        platforms: ['facebook'],
        status: 'pending',
        scheduled_at: null,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      const mockTopicQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'topic-1' }, error: null }),
      };

      const mockTaskQuery = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCreatedTask, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        if (table === 'content_topics') {
          return { select: mockTopicQuery.select } as any;
        }
        return mockTaskQuery as any;
      });

      const result = await createTask(mockProjectId, {
        topic_id: 'topic-1',
        platforms: ['facebook'],
      });

      expect(result.id).toBe('task-123');
      expect(result.platforms).toContain('facebook');
    });

    it('should reject invalid platforms', async () => {
      await expect(
        createTask(mockProjectId, {
          platforms: ['invalid_platform'] as any,
        })
      ).rejects.toThrow('Invalid platforms');
    });

    it('should reject if topic does not belong to project', async () => {
      const mockTopicQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: mockTopicQuery.select,
      } as any);

      await expect(
        createTask(mockProjectId, {
          topic_id: 'nonexistent',
          platforms: ['facebook'],
        })
      ).rejects.toThrow('Topic not found');
    });
  });

  describe('updateTask', () => {
    it('should update task status', async () => {
      const taskId = 'task-123';
      const mockUpdatedTask = {
        id: taskId,
        project_id: mockProjectId,
        status: 'completed',
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUpdatedTask, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      const result = await updateTask(mockProjectId, taskId, {
        status: 'completed',
      });

      expect(result.status).toBe('completed');
    });

    it('should reject invalid status', async () => {
      const taskId = 'task-123';

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: taskId }, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      await expect(
        updateTask(mockProjectId, taskId, {
          status: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid status');
    });
  });

  describe('getPendingTasks', () => {
    it('should fetch pending tasks due for processing', async () => {
      const mockPendingTasks = [
        {
          id: 'task-1',
          status: 'pending',
          scheduled_at: '2026-04-05T00:00:00Z',
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        },
      ];

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockPendingTasks, error: null }),
        select: vi.fn().mockReturnThis(),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getPendingTasks(10);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });
  });
});
