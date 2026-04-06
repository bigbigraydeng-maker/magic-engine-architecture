# CrazyContent Testing Strategy

## Overview

This document outlines the testing approach for the CrazyContent project, ensuring comprehensive coverage of all critical functionality with a target of 80%+ coverage.

## Test Types

### 1. Unit Tests
Test individual database functions in isolation using mocked dependencies.

**Location:** `src/lib/db/*.test.ts`
**Files:**
- `topics.test.ts` - ContentTopic CRUD operations
- `tasks.test.ts` - ContentTask CRUD and retrieval operations
- `sources.test.ts` - SocialSource creation and management
- `collected-posts.test.ts` - CollectedPost creation and engagement calculations
- `logs.test.ts` (planned) - Generation logging and cost tracking

**Coverage Target:** 85%+

### 2. Integration Tests
Test API endpoints with mocked database operations to verify request/response handling and error management.

**Location:** `src/app/api/crazy-content/**/route.test.ts`
**Files:**
- `topics/route.test.ts` - GET and POST topic operations
- `tasks/route.test.ts` - GET and POST task operations
- `tasks/[id]/route.test.ts` (planned) - GET and PATCH single task
- `sources/route.test.ts` (planned) - GET and POST source operations
- `generate/route.test.ts` (planned) - Content generation trigger

**Coverage Target:** 80%+

### 3. E2E Tests (Planned)
Test critical user workflows end-to-end with real database.

**Location:** `e2e/` (planned)
**Workflows:**
1. Create topic → Create task → Generate content
2. Scrape social posts → Calculate engagement → Create feedback
3. View reports → Analyze trends

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm test -- --coverage
```

### Specific Test File
```bash
npm test -- topics.test.ts
```

## Test Structure

Each test file follows this pattern:

```typescript
describe('Module/Feature Name', () => {
  beforeEach(() => {
    // Setup mocks and state
    vi.clearAllMocks()
  })

  describe('functionName', () => {
    it('should do the expected thing', async () => {
      // Arrange - set up test data
      // Act - call the function
      // Assert - verify the result
    })

    it('should handle error case', async () => {
      // Test error scenarios
    })
  })
})
```

## Mocking Strategy

### Database Mocks
The Supabase client is mocked at the module level to:
- Simulate database queries without requiring actual Supabase connection
- Test error handling and edge cases
- Isolate business logic from infrastructure

**Location:** `vi.mock('@/lib/supabase', ...)`

### Request/Response Mocks
API endpoint tests use mocked database functions to test:
- Input validation
- Error response formatting
- HTTP status code mapping
- Authorization checks

## Key Test Scenarios

### Authorization Tests
Every database operation verifies project ownership:
```typescript
it('should throw error if not project owner', async () => {
  vi.mocked(verifyProjectOwnership).mockResolvedValue(false)
  await expect(getTopics(projectId)).rejects.toThrow('Unauthorized')
})
```

### Input Validation Tests
- Required field validation
- Type validation (arrays, enums, etc.)
- Range validation (limit, offset)
- Enum validation (platforms, status, tone)

### Error Handling Tests
- Database errors → 500 status
- Authorization errors → 403 status
- Validation errors → 400 status
- Not found errors → 404 status

### Data Transformation Tests
- Date serialization/deserialization
- Metric calculations (engagement scoring)
- Response envelope formatting

## Coverage Goals

| Module | Target | Status |
|--------|--------|--------|
| topics.ts | 85% | In Progress |
| tasks.ts | 85% | In Progress |
| sources.ts | 85% | In Progress |
| collected-posts.ts | 80% | In Progress |
| logs.ts | 80% | Planned |
| API Routes | 80% | In Progress |
| **Overall** | **80%** | **In Progress** |

## Next Steps

1. **Implement E2E tests** using Vercel Agent Browser for critical user workflows
2. **Database integration tests** with real Supabase connection in CI/CD
3. **Performance testing** for query performance and generation speed
4. **Load testing** for concurrent user scenarios
5. **RLS policy testing** to verify multi-tenant isolation

## Common Test Patterns

### Testing Database Errors
```typescript
const mockQuery = { error: { message: 'Connection failed' } }
vi.mocked(supabase.from).mockReturnValue(mockQuery)
await expect(getTopics(projectId)).rejects.toThrow()
```

### Testing API Authorization
```typescript
vi.mocked(verifyProjectOwnership).mockResolvedValue(false)
const response = await POST(request)
expect(response.status).toBe(403)
```

### Testing Input Validation
```typescript
const response = await POST(new NextRequest(..., {
  method: 'POST',
  body: JSON.stringify({ /* missing required fields */ })
}))
expect(response.status).toBe(400)
```

## Debugging Tests

### Enable Debug Logging
```bash
DEBUG=vitest npm test
```

### Run Single Test
```bash
npm test -- --reporter=verbose topics.test.ts -t "should create topic"
```

### Watch Specific File
```bash
npm run test:watch -- topics.test.ts
```

## Test Maintenance

### When to Add Tests
- New database functions
- New API endpoints
- New validation rules
- Bug fixes (add regression test)

### When to Update Tests
- Schema changes
- API contract changes
- Error handling changes
- Business logic changes

### Removing Tests
Only remove tests when:
- Feature is completely removed
- Test is redundant with another test
- Test is for experimental code that's being deleted
