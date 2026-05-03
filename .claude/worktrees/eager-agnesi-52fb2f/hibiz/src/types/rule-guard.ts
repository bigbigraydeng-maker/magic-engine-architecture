/**
 * Rule Guard — 零 API 成本的输入预过滤层（v0.4）。
 * 实现见 `src/lib/compiler/rule-guard.ts`。
 */

export interface RuleGuardResult {
  /** 是否通过长度、黑名单、支持行业等检查（可通过但仍为 industry 模糊）。 */
  passed: boolean;
  /** `passed === false` 时的原因；通过时也可含非阻塞提示（如 ambiguous_industry）。 */
  reasons: string[];
  /** 给 LLM Compiler 的行业提示；双方均命中关键词时通常省略。 */
  industry_hint?: "real_estate" | "immigration";
  /** 语言提示。 */
  language_hint?: "en" | "zh" | "both";
  /** 从文案中匹配到的 NZ 城市（标题大小写规范化）。 */
  city?: string;
  /** 原始裁剪后长度。 */
  input_length: number;
  /** 命中的关键词/线索（小写或规范化片段）。 */
  contains_keywords?: string[];
}

export interface RuleGuardConfig {
  min_input_length: number;
  max_input_length: number;
  /** 小写比较；命中即拒绝。 */
  blacklist_words: readonly string[];
  /** 小写城市名，用于匹配。 */
  nz_cities: readonly string[];
  immigration_keywords: readonly string[];
  real_estate_keywords: readonly string[];
  /** 不支持的行业触发词（与 rule-based 对齐）。 */
  unsupported_industry_patterns: readonly RegExp[];
}
