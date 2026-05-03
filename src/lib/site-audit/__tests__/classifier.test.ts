import { describe, it, expect, beforeEach, vi } from 'vitest'
import OpenAI from 'openai'
import { classifyPage, classifyPages, type ClassificationResult } from '../classifier'

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn(),
}))

describe('classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockOpenAIResponse = (
    content: string
  ): { choices: Array<{ message: { content: string } }> } => ({
    choices: [{ message: { content } }],
  })

  // ===== classifyPage Tests =====

  describe('classifyPage', () => {
    it('should classify a blog page correctly', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'blog',
          topics: ['travel', 'New Zealand', 'itinerary planning'],
          primary_keyword: 'New Zealand travel guide',
          confidence: 0.95,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/blog/nz-travel-guide',
        'New Zealand Travel Guide for 2026',
        '# New Zealand Travel Guide\n\nNew Zealand is a beautiful country...'
      )

      expect(result.page_type).toBe('blog')
      expect(result.topics).toEqual(['travel', 'New Zealand', 'itinerary planning'])
      expect(result.primary_keyword).toBe('New Zealand travel guide')
      expect(result.confidence).toBe(0.95)
    })

    it('should classify a product page correctly', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'product',
          topics: ['luxury travel', 'tours', 'bookable package'],
          primary_keyword: 'premium New Zealand tours',
          confidence: 0.92,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/tours/luxury-nz',
        'Luxury New Zealand Tours',
        '## Luxury NZ Tour Package\n\nExperience the finest...'
      )

      expect(result.page_type).toBe('product')
      expect(result.primary_keyword).toBe('premium New Zealand tours')
    })

    it('should classify a landing page correctly', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'landing',
          topics: ['travel agency', 'New Zealand', 'home page'],
          primary_keyword: null,
          confidence: 0.88,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/',
        'Welcome to NZ Tours',
        '# Welcome to NZ Tours\n\nYour trusted travel partner...'
      )

      expect(result.page_type).toBe('landing')
      expect(result.primary_keyword).toBeNull()
    })

    it('should classify a contact page correctly', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'contact',
          topics: ['contact form', 'customer service'],
          primary_keyword: 'contact us',
          confidence: 0.98,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/contact',
        'Contact Us',
        '## Contact Form\n\nEmail: info@example.com'
      )

      expect(result.page_type).toBe('contact')
      expect(result.confidence).toBe(0.98)
    })

    it('should classify an about page correctly', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'about',
          topics: ['company history', 'team', 'values'],
          primary_keyword: 'about us',
          confidence: 0.96,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/about',
        'About Our Company',
        '## Our Story\n\nFounded in 2020...'
      )

      expect(result.page_type).toBe('about')
    })

    it('should handle null primary_keyword', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'other',
          topics: ['misc'],
          primary_keyword: null,
          confidence: 0.5,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/page',
        'Generic Page',
        'Some content'
      )

      expect(result.primary_keyword).toBeNull()
    })

    it('should cap topics at 5 items', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'blog',
          topics: ['topic1', 'topic2', 'topic3', 'topic4', 'topic5', 'topic6', 'topic7'],
          primary_keyword: 'main topic',
          confidence: 0.8,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/blog',
        'Blog Post',
        'Content'
      )

      expect(result.topics).toHaveLength(5)
    })

    it('should filter out empty topic strings', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'blog',
          topics: ['topic1', '', 'topic2', null, 'topic3'],
          primary_keyword: 'keyword',
          confidence: 0.8,
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/blog',
        'Blog Post',
        'Content'
      )

      expect(result.topics).toEqual(['topic1', 'topic2', 'topic3'])
    })

    it('should clamp confidence between 0 and 1', async () => {
      const mockResponse = mockOpenAIResponse(
        JSON.stringify({
          page_type: 'blog',
          topics: ['topic'],
          primary_keyword: 'kw',
          confidence: 2.5, // Invalid: > 1
        })
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/blog',
        'Blog Post',
        'Content'
      )

      expect(result.confidence).toBe(1)
    })

    it('should handle markdown code block in response', async () => {
      const mockResponse = mockOpenAIResponse(
        `\`\`\`json
{
  "page_type": "blog",
  "topics": ["topic"],
  "primary_keyword": "kw",
  "confidence": 0.9
}
\`\`\``
      )

      const mockCreate = vi.fn().mockResolvedValue(mockResponse)
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const result = await classifyPage(
        'https://example.com/blog',
        'Blog Post',
        'Content'
      )

      expect(result.page_type).toBe('blog')
      expect(result.confidence).toBe(0.9)
    })

    it('should throw on missing URL', async () => {
      await expect(
        classifyPage('', 'Title', 'Content')
      ).rejects.toThrow('URL is required')
    })

    it('should throw on missing title', async () => {
      await expect(
        classifyPage('https://example.com', '', 'Content')
      ).rejects.toThrow('Title is required')
    })

    it('should throw on missing markdown', async () => {
      await expect(
        classifyPage('https://example.com', 'Title', '')
      ).rejects.toThrow('Markdown content is required')
    })

    it('should throw on invalid JSON response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      })

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      await expect(
        classifyPage('https://example.com', 'Title', 'Content')
      ).rejects.toThrow()
    })

    it('should truncate markdown to 3000 chars', async () => {
      const longMarkdown = 'a'.repeat(5000)

      const mockCreate = vi.fn().mockResolvedValue(
        mockOpenAIResponse(
          JSON.stringify({
            page_type: 'blog',
            topics: [],
            primary_keyword: null,
            confidence: 0.5,
          })
        )
      )

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      await classifyPage('https://example.com', 'Title', longMarkdown)

      const callArgs = mockCreate.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user').content
      expect(userMessage).toContain('a'.repeat(3000))
      expect(userMessage).not.toContain('a'.repeat(3001))
    })

    it('should support custom temperature', async () => {
      const mockCreate = vi.fn().mockResolvedValue(
        mockOpenAIResponse(
          JSON.stringify({
            page_type: 'blog',
            topics: [],
            primary_keyword: null,
            confidence: 0.5,
          })
        )
      )

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      await classifyPage('https://example.com', 'Title', 'Content', { temperature: 0.7 })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 })
      )
    })
  })

  // ===== classifyPages Tests =====

  describe('classifyPages', () => {
    it('should classify multiple pages', async () => {
      const mockCreate = vi.fn()
        .mockResolvedValueOnce(
          mockOpenAIResponse(
            JSON.stringify({
              page_type: 'landing',
              topics: [],
              primary_keyword: null,
              confidence: 0.9,
            })
          )
        )
        .mockResolvedValueOnce(
          mockOpenAIResponse(
            JSON.stringify({
              page_type: 'blog',
              topics: ['travel'],
              primary_keyword: 'guide',
              confidence: 0.85,
            })
          )
        )

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const pages = [
        { url: 'https://example.com/', title: 'Home', markdown: 'Welcome' },
        {
          url: 'https://example.com/blog/guide',
          title: 'Travel Guide',
          markdown: 'Travel tips',
        },
      ]

      const results = await classifyPages(pages)

      expect(results.size).toBe(2)
      expect(results.get('https://example.com/')?.page_type).toBe('landing')
      expect(results.get('https://example.com/blog/guide')?.page_type).toBe('blog')
    })

    it('should handle partial failures gracefully', async () => {
      const mockCreate = vi.fn()
        .mockResolvedValueOnce(
          mockOpenAIResponse(
            JSON.stringify({
              page_type: 'landing',
              topics: [],
              primary_keyword: null,
              confidence: 0.9,
            })
          )
        )
        .mockRejectedValueOnce(new Error('API Error'))

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const pages = [
        { url: 'https://example.com/', title: 'Home', markdown: 'Welcome' },
        { url: 'https://example.com/fail', title: 'Fail', markdown: 'Content' },
      ]

      const results = await classifyPages(pages)

      expect(results.size).toBe(2)
      expect(results.get('https://example.com/')?.page_type).toBe('landing')
      // Failed page should have fallback classification
      expect(results.get('https://example.com/fail')?.page_type).toBe('other')
      expect(results.get('https://example.com/fail')?.confidence).toBe(0)
    })

    it('should return empty map for empty input', async () => {
      const results = await classifyPages([])
      expect(results.size).toBe(0)
    })

    it('should preserve URL keys in map', async () => {
      const mockCreate = vi.fn().mockResolvedValue(
        mockOpenAIResponse(
          JSON.stringify({
            page_type: 'blog',
            topics: [],
            primary_keyword: null,
            confidence: 0.5,
          })
        )
      )

      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      } as any))

      const pages = [
        { url: 'https://example.com/page1', title: 'P1', markdown: 'C1' },
        { url: 'https://example.com/page2', title: 'P2', markdown: 'C2' },
        { url: 'https://example.com/page3', title: 'P3', markdown: 'C3' },
      ]

      const results = await classifyPages(pages)

      expect(results.has('https://example.com/page1')).toBe(true)
      expect(results.has('https://example.com/page2')).toBe(true)
      expect(results.has('https://example.com/page3')).toBe(true)
    })
  })
})
