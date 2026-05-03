# Quick Reference Guide

## Common Commands

```bash
# Development
npm run dev                    # Start dev server at :3000
npm run dev:clean            # Clean build cache and start
npm run build                # Production build
npm start                    # Start production server

# Testing
npm test                     # Run all tests once
npm run test:watch          # Watch mode (re-run on changes)
npm test -- --coverage      # With coverage report
npm test -- <filename>      # Run specific test file
npm test -- -t "test name"  # Run specific test case

# Code Quality
npm run lint                # Run ESLint
npm run type-check         # TypeScript type checking
```

## API Quick Reference

### Create Topic
```bash
curl -X POST http://localhost:3000/api/crazy-content/topics \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_123",
    "name": "AI Marketing",
    "keywords": ["ai", "marketing", "business"],
    "tone": "professional",
    "frequency_daily": 1
  }'
```

### Create Task
```bash
curl -X POST http://localhost:3000/api/crazy-content/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_123",
    "topic_id": "topic_456",
    "platforms": ["facebook", "xiaohongshu"]
  }'
```

### Generate Content
```bash
curl -X POST http://localhost:3000/api/crazy-content/generate \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_123",
    "topic_ids": ["topic_1", "topic_2"],
    "platforms": ["facebook", "xiaohongshu"],
    "scheduled_at": "2026-04-07T10:00:00Z"
  }'
```

### Update Task Status
```bash
curl -X PATCH "http://localhost:3000/api/crazy-content/tasks/task_123?project_id=proj_123" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "generated_captions": {
      "facebook": {
        "zh": "AI创业必看",
        "en": "Essential AI Tips"
      }
    },
    "image_url": "https://example.com/image.jpg"
  }'
```

### Get Task Details
```bash
curl "http://localhost:3000/api/crazy-content/tasks/task_123?project_id=proj_123"
```

### List Tasks with Filtering
```bash
curl "http://localhost:3000/api/crazy-content/tasks?project_id=proj_123&status=pending&limit=10&offset=0"
```

### Connect Social Account
```bash
curl -X POST http://localhost:3000/api/crazy-content/sources \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_123",
    "platform": "facebook",
    "account_id": "123456789",
    "account_name": "CEO Account",
    "api_token": "fb_access_token"
  }'
```

## Database Operations Cheat Sheet

### Topics (src/lib/db/topics.ts)

```typescript
import { getTopics, createTopic, updateTopic, deleteTopic } from '@/lib/db/topics'

// Get all topics
const topics = await getTopics(projectId)

// Create topic
const topic = await createTopic(projectId, {
  name: 'AI Tips',
  keywords: ['ai', 'tips'],
  tone: 'professional',
  frequency_daily: 1
})

// Update topic
const updated = await updateTopic(projectId, topicId, {
  name: 'Updated Name'
})

// Delete topic (soft delete)
await deleteTopic(projectId, topicId)
```

### Tasks (src/lib/db/tasks.ts)

```typescript
import { getTask, getTasks, createTask, updateTask, getPendingTasks } from '@/lib/db/tasks'

// Get single task
const task = await getTask(projectId, taskId)

// List tasks
const { items, total } = await getTasks(projectId, {
  status: 'pending',
  limit: 10,
  offset: 0
})

// Create task
const task = await createTask(projectId, {
  topic_id: 'topic_123',
  platforms: ['facebook'],
  scheduled_at: new Date('2026-04-07')
})

// Update task
const updated = await updateTask(projectId, taskId, {
  status: 'completed',
  generated_captions: { ... }
})

// Get pending tasks (for cron job)
const pending = await getPendingTasks(10)
```

### Sources (src/lib/db/sources.ts)

```typescript
import { getSources, createSource, getActiveSources } from '@/lib/db/sources'

// List sources
const sources = await getSources(projectId)

// Create source
const source = await createSource(projectId, {
  platform: 'facebook',
  account_id: 'fb_123',
  api_token: 'token_xyz'
})

// Get active sources
const active = await getActiveSources(projectId, 'xiaohongshu')
```

### Collected Posts (src/lib/db/collected-posts.ts)

```typescript
import { getCollectedPosts, createCollectedPost, getHighEngagementPosts } from '@/lib/db/collected-posts'

// List posts
const { items, total } = await getCollectedPosts(projectId, {
  platform: 'facebook',
  limit: 20
})

// Create post
const post = await createCollectedPost(sourceId, {
  external_post_id: 'fb_post_123',
  platform: 'facebook',
  content: 'Post content',
  metrics: {
    likes: 100,
    comments: 20,
    shares: 5,
    views: 500
  }
})

// Get high engagement posts
const trending = await getHighEngagementPosts(projectId, 75, 10)
```

### Logs (src/lib/db/logs.ts)

```typescript
import { logGeneration, getLogs, getCostSummary } from '@/lib/db/logs'

// Log an operation
await logGeneration({
  project_id: projectId,
  operation: 'generate_copy',
  cost_usd: 0.001,
  duration_ms: 2500,
  status: 'success'
})

// Get logs
const { items, total } = await getLogs(projectId, {
  status: 'success',
  limit: 50
})

// Get cost summary
const summary = await getCostSummary(projectId, 30)
// Returns: { total_cost, operation_breakdown, daily_average }
```

## Error Handling

All database functions throw errors on failure. Always wrap in try-catch:

```typescript
try {
  const topic = await createTopic(projectId, input)
} catch (error) {
  // Log error
  console.error(error.message)

  // In API route:
  const err = handleSupabaseError(error)
  const statusCode = err.message.includes('Unauthorized') ? 403 : 500
  return NextResponse.json(
    { success: false, error: err },
    { status: statusCode }
  )
}
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | RLS violation, not project owner | Verify project ownership |
| "Topic not found" | Topic ID doesn't exist or wrong project | Check topic_id and project_id |
| "Invalid platforms" | Platform not 'facebook' or 'xiaohongshu' | Use valid platform values |
| "Invalid status" | Status not in enum | Use: pending, generating, completed, failed |
| "Account already connected" | Duplicate social account | Use different account_id |

## Type Definitions

Key types are in `src/types/crazy-content.ts`:

```typescript
type Platform = 'facebook' | 'xiaohongshu'
type TaskStatus = 'pending' | 'generating' | 'completed' | 'failed'
type Tone = 'professional' | 'casual' | 'inspirational'

interface ContentTopic { ... }
interface ContentTask { ... }
interface SocialSource { ... }
interface CollectedPost { ... }
interface EngagementMetrics { ... }
interface GenerationLog { ... }

// API Response format
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: { message: string; details?: any }
  metadata?: { limit?: number; offset?: number; total?: number }
}
```

## Environment Variables

### Development (.env.local)
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

### Deployment (Vercel)
Set same variables in Vercel project settings → Environment Variables

## Testing Patterns

### Database Function Test
```typescript
it('should create topic with valid input', async () => {
  const result = await createTopic(projectId, {
    name: 'Test',
    keywords: ['test']
  })
  expect(result.id).toBeDefined()
})
```

### Authorization Test
```typescript
it('should reject if not owner', async () => {
  vi.mocked(verifyProjectOwnership).mockResolvedValue(false)
  await expect(getTopics(projectId)).rejects.toThrow('Unauthorized')
})
```

### API Endpoint Test
```typescript
it('should return 400 on missing field', async () => {
  const request = new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ /* missing field */ })
  })
  const response = await POST(request)
  expect(response.status).toBe(400)
})
```

## Performance Tips

1. **Pagination**: Always use limit/offset for lists
   ```typescript
   getTasks(projectId, { limit: 10, offset: 0 })
   ```

2. **Filtering**: Use database filters, not client-side
   ```typescript
   getTasks(projectId, { status: 'completed' })
   ```

3. **RLS**: Database handles authorization, no app-level checks needed

4. **Indexes**: Supabase has indexes on:
   - project_id (all tables)
   - status (content_tasks)
   - platform (social_sources, collected_posts)

## Debugging

### Enable Debug Logs
```bash
DEBUG=* npm run dev
```

### Check Database
Use Supabase Dashboard → SQL Editor to inspect:
- View RLS policies
- Check row counts
- Query data directly
- Analyze query performance

### Test Debugging
```bash
# Run single test with verbose output
npm test -- --reporter=verbose topics.test.ts

# Watch mode for development
npm run test:watch -- topics.test.ts
```

## Git Workflow

```bash
# Create feature branch
git checkout -b feat/feature-name

# Make changes and commit
git add .
git commit -m "feat: description"

# Push branch
git push -u origin feat/feature-name

# Create PR and request review
```

## Useful Resources

- [Next.js 14 Docs](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Vitest Guide](https://vitest.dev/guide/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- Project docs: [TESTING.md](./TESTING.md), [DAY2_SUMMARY.md](./DAY2_SUMMARY.md)

## Project Status

- ✅ Days 1-2: Database & API (Complete)
- 🚧 Days 3-5: Content Generation & Integration
- 🚧 Days 6-8: UI & Dashboard
- ⏳ Days 9-10: Testing & Deployment

Current: **40% Complete** - Ready for Phase 3
