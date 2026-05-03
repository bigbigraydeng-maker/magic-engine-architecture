/**
 * Tests for Content Topics Database Operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTopics, createTopic, updateTopic, deleteTopic } from './topics';
import * as supabaseModule from '@/lib/supabase';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
  verifyProjectOwnership: vi.fn(),
  handleSupabaseError: vi.fn((error) => error),
}));

describe('Topics Database Operations', () => {
  const mockProjectId = 'project-123';
  const mockUserId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock verifyProjectOwnership to return true by default
    vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(true);
  });

  describe('getTopics', () => {
    it('should fetch all topics for a project', async () => {
      const mockTopics = [
        {
          id: 'topic-1',
          project_id: mockProjectId,
          name: 'AI Tips',
          description: 'Tips about AI',
          keywords: ['ai', 'tips'],
          target_audience: 'Entrepreneurs',
          tone: 'professional',
          frequency_daily: 1,
          enabled: true,
          created_at: '2026-04-06T00:00:00Z',
          updated_at: '2026-04-06T00:00:00Z',
        },
      ];

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: mockTopics, error: null, count: 1 }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      const result = await getTopics(mockProjectId);

      expect(result).toEqual(mockTopics);
      expect(supabaseModule.verifyProjectOwnership).toHaveBeenCalledWith(mockProjectId);
    });

    it('should throw error if not project owner', async () => {
      vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(false);

      await expect(getTopics(mockProjectId)).rejects.toThrow('Unauthorized');
    });

    it('should throw error on database failure', async () => {
      const mockError = { message: 'Database error' };

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: null, error: mockError, count: 0 }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(mockQuery),
      } as any);

      await expect(getTopics(mockProjectId)).rejects.toThrow('Failed to fetch topics');
    });
  });

  describe('createTopic', () => {
    const validInput = {
      name: 'AI Marketing',
      keywords: ['ai', 'marketing'],
      description: 'Marketing with AI',
      target_audience: 'Entrepreneurs',
      tone: 'professional' as const,
      frequency_daily: 1,
    };

    it('should create a new topic with valid input', async () => {
      const mockCreatedTopic = {
        id: 'topic-123',
        project_id: mockProjectId,
        ...validInput,
        enabled: true,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      const mockQuery = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCreatedTopic, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      const result = await createTopic(mockProjectId, validInput);

      expect(result.id).toBe('topic-123');
      expect(result.name).toBe('AI Marketing');
      expect(supabaseModule.verifyProjectOwnership).toHaveBeenCalledWith(mockProjectId);
    });

    it('should reject invalid tone values', async () => {
      const invalidInput = {
        ...validInput,
        tone: 'invalid' as any,
      };

      await expect(createTopic(mockProjectId, invalidInput)).rejects.toThrow('Invalid tone');
    });

    it('should reject empty keywords', async () => {
      const invalidInput = {
        ...validInput,
        keywords: [],
      };

      await expect(createTopic(mockProjectId, invalidInput)).rejects.toThrow('keywords must not be empty');
    });

    it('should throw error if not project owner', async () => {
      vi.mocked(supabaseModule.verifyProjectOwnership).mockResolvedValue(false);

      await expect(createTopic(mockProjectId, validInput)).rejects.toThrow('Unauthorized');
    });
  });

  describe('updateTopic', () => {
    it('should update an existing topic', async () => {
      const topicId = 'topic-123';
      const updates = { name: 'Updated AI Tips' };

      const mockUpdatedTopic = {
        id: topicId,
        project_id: mockProjectId,
        name: 'Updated AI Tips',
        description: 'Tips about AI',
        keywords: ['ai', 'tips'],
        target_audience: 'Entrepreneurs',
        tone: 'professional',
        frequency_daily: 1,
        enabled: true,
        created_at: '2026-04-06T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
      };

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUpdatedTopic, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      const result = await updateTopic(mockProjectId, topicId, updates);

      expect(result.name).toBe('Updated AI Tips');
    });

    it('should throw error if topic not found', async () => {
      const topicId = 'nonexistent';

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      await expect(updateTopic(mockProjectId, topicId, { name: 'Test' })).rejects.toThrow('Topic not found');
    });
  });

  describe('deleteTopic', () => {
    it('should delete a topic (soft delete)', async () => {
      const topicId = 'topic-123';

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: topicId }, error: null }),
      };

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(mockQuery as any);

      await deleteTopic(mockProjectId, topicId);

      expect(supabaseModule.verifyProjectOwnership).toHaveBeenCalledWith(mockProjectId);
    });
  });
});
