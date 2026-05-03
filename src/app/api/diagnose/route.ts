import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runOpenAI } from '@/lib/ai-tracker/runners/openai'
import { runClaude } from '@/lib/ai-tracker/runners/claude'

const BRAND = 'CTS Tours NZ'
const MARKET: 'au' | 'nz' | 'au-nz' = 'nz'
const TEST_QUESTION =
  'What are the best New Zealand tour operators for Australian travelers?'

export async function GET() {
  const results: Record<string, any> = {}

  // 1. 检查 CTS Tours 客户
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .eq('name', BRAND)
    .limit(1)

  if (clientError || !clients || clients.length === 0) {
    results.ctsToursClient = {
      status: 'FAIL',
      error: clientError?.message || 'Client not found',
    }
  } else {
    const ctsTours = clients[0]
    results.ctsToursClient = {
      status: 'OK',
      id: ctsTours.id,
      name: ctsTours.name,
      domain: ctsTours.domain,
    }

    // 2. 检查问句
    const { data: queries, error: queryError } = await supabaseAdmin
      .from('ai_visibility_queries')
      .select('id, question, enabled')
      .eq('client_id', ctsTours.id)
      .eq('enabled', true)

    if (queryError || !queries) {
      results.queries = {
        status: 'FAIL',
        error: queryError?.message,
      }
    } else {
      results.queries = {
        status: 'OK',
        count: queries.length,
        samples: queries.slice(0, 3).map((q: any) => q.question),
      }
    }
  }

  // 3. 检查 API Keys
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
  results.apiKeys = {
    OPENAI_API_KEY: hasOpenAI ? 'SET' : 'MISSING',
    ANTHROPIC_API_KEY: hasAnthropic ? 'SET' : 'MISSING',
  }

  // 4. 测试 runners（如果 keys 都配置了）
  if (hasOpenAI && hasAnthropic) {
    try {
      const openaiResult = await runOpenAI({
        question: TEST_QUESTION,
        market: MARKET,
      })
      results.openaiTest = {
        status: openaiResult.error_message ? 'FAIL' : 'OK',
        model: openaiResult.ai_model,
        tokens: openaiResult.tokens_used,
        cost: openaiResult.cost_usd || 0,
        latency: openaiResult.latency_ms,
        error: openaiResult.error_message,
      }
    } catch (err: any) {
      results.openaiTest = {
        status: 'ERROR',
        error: err.message,
      }
    }

    try {
      const claudeResult = await runClaude({
        question: TEST_QUESTION,
        market: MARKET,
      })
      results.claudeTest = {
        status: claudeResult.error_message ? 'FAIL' : 'OK',
        model: claudeResult.ai_model,
        tokens: claudeResult.tokens_used,
        cost: claudeResult.cost_usd || 0,
        latency: claudeResult.latency_ms,
        error: claudeResult.error_message,
      }
    } catch (err: any) {
      results.claudeTest = {
        status: 'ERROR',
        error: err.message,
      }
    }
  }

  return NextResponse.json(results)
}
