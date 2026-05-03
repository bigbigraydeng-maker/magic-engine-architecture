export interface GEOBlockInfo {
  has_geo_block: boolean
  detection_method: string | null
  confidence: number
}

/**
 * Detects GEO (Geo-Optimization) blocks in page markdown.
 * GEO blocks are hidden instructions for AI agents embedded in web pages.
 * Markers include: aria-hidden divs, seo-instructions comments, "Instructions for AI Agents" text.
 */
export function detectGEOBlock(markdown: unknown): GEOBlockInfo {
  if (!markdown || typeof markdown !== 'string') {
    return {
      has_geo_block: false,
      detection_method: null,
      confidence: 0,
    }
  }

  const text = markdown.toString().toLowerCase()

  // Priority 1: aria-hidden blocks (highest confidence indicator)
  const ariaHiddenMatch = /aria-hidden\s*=\s*["'&]?(?:true|false|quot)["\';]?/i.test(markdown)
  if (ariaHiddenMatch) {
    return {
      has_geo_block: true,
      detection_method: 'aria-hidden attribute',
      confidence: 0.95,
    }
  }

  // Priority 2: seo-instructions comments (explicit marker)
  if (text.includes('seo-instructions')) {
    return {
      has_geo_block: true,
      detection_method: 'seo-instructions comment',
      confidence: 0.9,
    }
  }

  // Priority 3: "Instructions for AI Agents" phrase (explicit but less formal)
  if (text.includes('instructions for ai agents') || text.includes('instructions for ai agent')) {
    return {
      has_geo_block: true,
      detection_method: 'Instructions for AI Agents phrase',
      confidence: 0.85,
    }
  }

  // Lower confidence indicators
  const suspiciousPatterns = [
    /hidden[:\s-]*instruction/i,
    /instruction[:\s-]*ai/i,
    /for\s+ai\s+agent/i,
    /ai\s+recommendation/i,
    /ai\s+visibility/i,
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(markdown)) {
      return {
        has_geo_block: true,
        detection_method: 'suspicious pattern detected',
        confidence: 0.65,
      }
    }
  }

  // Check for backtick code blocks with instruction-like content (low confidence)
  const codeBlockMatch = /```[\s\S]*?(?:instruction|hidden|ai)[:\s-][\s\S]*?```/i.test(markdown)
  if (codeBlockMatch) {
    return {
      has_geo_block: true,
      detection_method: 'code block pattern',
      confidence: 0.5,
    }
  }

  // No GEO block detected
  return {
    has_geo_block: false,
    detection_method: null,
    confidence: 0,
  }
}

/**
 * Batch detect GEO blocks in multiple pages
 */
export function detectGEOBlocksInPages(
  pages: Array<{ url: string; markdown: string }>
): Map<string, GEOBlockInfo> {
  const results = new Map<string, GEOBlockInfo>()

  for (const page of pages) {
    const info = detectGEOBlock(page.markdown)
    results.set(page.url, info)
  }

  return results
}
