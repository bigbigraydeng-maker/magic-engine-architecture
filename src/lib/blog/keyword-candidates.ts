/**
 * Keyword Candidate Extraction — GEO mode
 *
 * Extracts seed keyword candidates from AI Tracker query text.
 * These candidates are then enriched via SEMrush to classify blog opportunities.
 *
 * Reference: ROADMAP.md P7.3.25, ARCHITECTURE.md §13.2.2
 */

/**
 * A candidate keyword extracted from query text, ready for SEMrush enrichment.
 */
export interface KeywordCandidate {
  keyword: string
  confidence: number // 0-1, higher = more likely to be the "true" keyword
  source: 'title' | 'entities' | 'semantic'
  intent_hint?: string // comparison | how_to | recommendation | decision | discovery
}

/**
 * Extract keyword candidates from an AI Tracker query text.
 *
 * Strategy:
 * 1. Title-based: The entire query text is a strong candidate
 * 2. Entity extraction: Multi-word phrases (brand/product/location mentions)
 * 3. Semantic simplification: Core nouns + verbs
 *
 * @param queryText - The AI Tracker question/query (e.g., "best tour operators in New Zealand for China trips")
 * @returns Array of keyword candidates, sorted by confidence (highest first)
 */
export function extractKeywordCandidates(queryText: string): KeywordCandidate[] {
  if (!queryText || queryText.trim().length === 0) {
    return []
  }

  const candidates: KeywordCandidate[] = []
  const seenKeywords = new Set<string>()

  // 1. Full query as title candidate (high confidence)
  const fullQuery = queryText.toLowerCase().trim()
  if (fullQuery.length > 0 && !seenKeywords.has(fullQuery)) {
    candidates.push({
      keyword: fullQuery,
      confidence: 0.95,
      source: 'title',
      intent_hint: inferIntentFromQuery(fullQuery),
    })
    seenKeywords.add(fullQuery)
  }

  // 2. Entity extraction: Multi-word phrases (geographic locations, product types)
  // Pattern: [location/brand] + [product/service]
  const entityPatterns = [
    /(?:for|in|to)\s+([A-Z][^,\.]*[A-Z][^,\.]*)/g, // "in New Zealand", "for Australia"
    /(?:best|top|leading)\s+([a-z\s]+?)(?:\s+in\s+|\s+for\s+|$)/gi, // "best tour operators in"
  ]

  for (const pattern of entityPatterns) {
    let match
    while ((match = pattern.exec(queryText)) !== null) {
      const phrase = match[1].toLowerCase().trim()
      if (phrase.length > 0 && phrase.length < 100 && !seenKeywords.has(phrase)) {
        candidates.push({
          keyword: phrase,
          confidence: 0.7,
          source: 'entities',
          intent_hint: inferIntentFromQuery(queryText),
        })
        seenKeywords.add(phrase)
      }
    }
  }

  // 3. Semantic simplification: Remove common question words
  // "what are the best..." → "best ..."
  // "how do I find..." → "find ..."
  const commonQuestionWords = /^(what|how|which|where|why|when|can|do|does|is|are|the|a|an)\s+/i
  const simplified = fullQuery.replace(commonQuestionWords, '').trim()
  if (simplified.length > 3 && simplified !== fullQuery && !seenKeywords.has(simplified)) {
    candidates.push({
      keyword: simplified,
      confidence: 0.65,
      source: 'semantic',
      intent_hint: inferIntentFromQuery(queryText),
    })
    seenKeywords.add(simplified)
  }

  // 4. Noun phrase extraction: Extract common noun phrases
  // E.g., "tour operators", "travel agents", "visa services"
  const nounPhrases = extractNounPhrases(fullQuery)
  for (const phrase of nounPhrases) {
    if (!seenKeywords.has(phrase)) {
      candidates.push({
        keyword: phrase,
        confidence: 0.6,
        source: 'semantic',
        intent_hint: inferIntentFromQuery(queryText),
      })
      seenKeywords.add(phrase)
    }
  }

  // Sort by confidence (descending), then by keyword length (longer is often more specific)
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence
    }
    return b.keyword.length - a.keyword.length
  })

  // Return top 5 candidates
  return candidates.slice(0, 5)
}

/**
 * Infer search intent from query text.
 *
 * Simple heuristic-based classification:
 * - "best/top/leading" → recommendation
 * - "how to" → how_to
 * - "vs/compared to" → comparison
 * - "find/where/how do I get" → discovery
 * - otherwise → decision (general commercial intent)
 */
function inferIntentFromQuery(queryText: string): string {
  const lower = queryText.toLowerCase()

  if (/\b(best|top|leading|recommended)\b/.test(lower)) {
    return 'recommendation'
  }
  if (/\b(how\s+to|how\s+do|guide|steps?)\b/.test(lower)) {
    return 'how_to'
  }
  if (/\b(vs|versus|compared\s+to|difference\s+between)\b/.test(lower)) {
    return 'comparison'
  }
  if (/\b(find|where|when|which|what)\b/.test(lower)) {
    return 'discovery'
  }

  // Default: decision-stage (user likely evaluating options)
  return 'decision'
}

/**
 * Extract noun phrases from query text using simple pattern matching.
 *
 * Looks for common noun phrase patterns:
 * - "[adjective]+ [noun]+ [prep + noun]?"
 * - Prioritizes 2-3 word phrases
 */
function extractNounPhrases(queryText: string): string[] {
  const phrases: string[] = []

  // Common noun phrase pattern: [adj] [noun] [noun]?
  // Examples: "tour operators", "travel agents", "visa services"
  const words = queryText.toLowerCase().split(/\s+/)

  // Common service-related nouns
  const serviceNouns = new Set([
    'operators', 'agents', 'services', 'tours', 'companies', 'businesses',
    'providers', 'vendors', 'specialists', 'consultants', 'experts',
    'guides', 'packages', 'accommodations', 'flights', 'hotels',
    'restaurants', 'attractions', 'visas', 'insurance', 'arrangements',
  ])

  // Common adjectives
  const adjectives = new Set([
    'best', 'top', 'leading', 'good', 'great', 'reputable',
    'reliable', 'professional', 'affordable', 'cheap', 'luxury',
    'budget', 'small', 'large', 'local', 'international',
  ])

  // Look for 2-3 word phrases ending in a service noun
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (serviceNouns.has(word)) {
      // Single noun
      if (!phrases.includes(word) && word.length > 3) {
        phrases.push(word)
      }

      // Two-word phrase (adjective + noun)
      if (i > 0 && (adjectives.has(words[i - 1]) || words[i - 1].length > 4)) {
        const twoWord = `${words[i - 1]} ${word}`
        if (!phrases.includes(twoWord) && twoWord.length < 50) {
          phrases.push(twoWord)
        }
      }

      // Three-word phrase (noun + noun or adjective + noun + noun)
      if (i > 1) {
        const threeWord = `${words[i - 2]} ${words[i - 1]} ${word}`
        if (!phrases.includes(threeWord) && threeWord.length < 50 && !threeWord.startsWith('the ')) {
          phrases.push(threeWord)
        }
      }
    }
  }

  return phrases
}
