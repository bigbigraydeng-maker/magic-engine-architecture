/**
 * AI Tracker engine internal codes → display names.
 *
 * AI Visibility Tracker is specifically about tracking which AI platforms mention
 * the client — showing real platform names IS the product value here.
 * This is an exception to the general CLAUDE.md §三 vendor-name rule.
 */

export const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  perplexity: 'Perplexity',
  google: 'Google AI',
};

export function getEngineDisplayName(engine: string): string {
  return ENGINE_DISPLAY_NAMES[engine.toLowerCase()] ?? engine;
}
