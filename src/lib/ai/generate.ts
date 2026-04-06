/**
 * Content Generation Engine
 * Integrates with OpenAI to generate platform-specific captions
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type Platform = 'facebook' | 'xiaohongshu';
export type Language = 'zh' | 'en';

export interface GenerationInput {
  topic: string;
  keywords: string[];
  targetAudience?: string;
  tone: 'professional' | 'casual' | 'inspirational';
  platform: Platform;
  language: Language;
}

export interface GenerationOutput {
  captions: string[];
  hashtags: string[];
  cost_usd: number;
  tokens_used: number;
}

/**
 * Generate captions for a given topic and platform
 */
export async function generateCaptions(input: GenerationInput): Promise<GenerationOutput> {
  const prompt = buildPrompt(input);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: getSystemPrompt(input.platform, input.language),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content || '';
    const { captions, hashtags } = parseGenerationResponse(content);

    // Calculate cost: gpt-4o-mini is $0.15 per 1M input tokens, $0.60 per 1M output tokens
    const inputCost = (response.usage?.prompt_tokens || 0) * 0.00000015;
    const outputCost = (response.usage?.completion_tokens || 0) * 0.0000006;
    const totalCost = inputCost + outputCost;

    return {
      captions,
      hashtags,
      cost_usd: parseFloat(totalCost.toFixed(6)),
      tokens_used: (response.usage?.total_tokens || 0),
    };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get system prompt based on platform and language
 */
function getSystemPrompt(platform: Platform, language: Language): string {
  const languageName = language === 'zh' ? '简体中文' : 'English';

  if (platform === 'xiaohongshu') {
    return `你是一位小红书内容创作专家。你的任务是为给定的主题创建引人入胜的小红书文案。

要求：
- 使用${languageName}
- 文案要符合小红书的平台文化（分享、真诚、互动）
- 包含3-5个相关的话题标签（#开头）
- 字数控制在150-280字之间
- 语言要亲切、自然、容易引起共鸣
- 要提出有价值的观点或建议
- 不要过度营销或硬广告

输出格式：
主文案：[文案内容]
标签：[多个标签，用空格分隔]`;
  }

  return `You are a Facebook content expert. Your task is to create engaging Facebook captions for the given topic.

Requirements:
- Use ${languageName}
- Write in a conversational, authentic tone
- Include 3-5 relevant hashtags
- Keep length between 100-200 characters
- Make it shareable and engaging
- Ask questions to encourage comments
- No hard selling or aggressive promotion

Output format:
Caption: [caption content]
Hashtags: [space-separated hashtags]`;
}

/**
 * Build user prompt from input
 */
function buildPrompt(input: GenerationInput): string {
  const parts = [
    `Topic: ${input.topic}`,
    `Keywords: ${input.keywords.join(', ')}`,
  ];

  if (input.targetAudience) {
    parts.push(`Target Audience: ${input.targetAudience}`);
  }

  parts.push(`Tone: ${input.tone}`);
  parts.push(`Generate 3 different caption options for this topic.`);

  return parts.join('\n');
}

/**
 * Parse generation response
 */
function parseGenerationResponse(content: string): { captions: string[]; hashtags: string[] } {
  const captions: string[] = [];
  const allHashtags: Set<string> = new Set();

  // Split by "Option" or numbered entries
  const options = content.split(/(?:Option\s+\d+:|###|---)/i).filter(s => s.trim());

  for (const option of options) {
    // Extract caption
    const captionMatch = option.match(/(?:Caption|主文案)[:\s]+([^\n]+(?:\n(?!(?:标签|Hashtags|Tags)))*)/i);
    if (captionMatch) {
      const caption = captionMatch[1]
        .replace(/^[\s-:]+/, '') // Remove leading dashes/colons
        .replace(/\n[\s-]/g, '\n') // Clean up lines
        .trim();
      if (caption.length > 0) {
        captions.push(caption);
      }
    }

    // Extract hashtags
    const hashtagMatch = option.match(/(?:标签|Hashtags?|Tags)[:\s]+([^\n]+)/i);
    if (hashtagMatch) {
      const tags = hashtagMatch[1]
        .split(/[\s,]/g)
        .filter(tag => tag.startsWith('#') || tag.length > 0)
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
      tags.forEach(tag => allHashtags.add(tag));
    }
  }

  // Fallback: if parsing failed, extract any hashtags from content
  if (allHashtags.size === 0) {
    const hashtagMatches = content.match(/#[\w\u4e00-\u9fa5]+/g) || [];
    hashtagMatches.forEach(tag => allHashtags.add(tag));
  }

  return {
    captions: captions.slice(0, 3), // Max 3 options
    hashtags: Array.from(allHashtags).slice(0, 5), // Max 5 hashtags
  };
}

/**
 * Generate image search queries for content
 */
export async function generateImageQueries(input: {
  topic: string;
  keywords: string[];
  platform: Platform;
}): Promise<string[]> {
  const prompt = `For the topic "${input.topic}" with keywords [${input.keywords.join(', ')}],
generate 3 different search queries that would find relevant, high-quality images suitable for ${input.platform}.
Return only the 3 search queries, one per line, without numbering or explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });

    const content = response.choices[0].message.content || '';
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 3);
  } catch (error) {
    console.error('Error generating image queries:', error);
    return [];
  }
}

/**
 * Validate OpenAI API key at startup
 */
export async function validateOpenAIKey(): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not configured');
    return false;
  }

  try {
    // Make a minimal API call to validate the key
    await openai.models.list();
    console.log('✓ OpenAI API key validated');
    return true;
  } catch (error) {
    console.error('✗ OpenAI API key validation failed:', error);
    return false;
  }
}

/**
 * Mock generation for development
 */
export async function generateCaptionsMock(input: GenerationInput): Promise<GenerationOutput> {
  const mockCaptions = {
    facebook_en: [
      `Hey entrepreneurs! 🚀 Did you know that AI-powered content can boost your engagement by 300%? Here's how...`,
      `Your CEO could be using ${input.keywords[0]} to scale faster. Learn the secret today!`,
      `We built a $1B AI company by focusing on ${input.keywords[0]}. What's holding you back?`,
    ],
    facebook_zh: [
      `AI创业者必看！🚀 你知道吗，用AI生成的内容能让你的数据翻倍增长！`,
      `我们的CEO用${input.keywords[0]}打造了十亿美金的公司。你呢？`,
      `想要像我们一样成功？先掌握这个${input.keywords[0]}的秘诀...`,
    ],
    xiaohongshu_zh: [
      `【${input.topic}秘籍】\n作为一个${input.tone}的内容创作者，我想告诉你，${input.keywords[0]}真的改变了我的创业之路。最关键的是...`,
      `小红书创作者必读！\n你有没有想过，为什么有些账号一个月粉丝增长10倍？秘密就在于懂${input.keywords[0]}...`,
      `${input.topic}不止这样简单\n我在创业的这3年，学到了最值得分享的是...`,
    ],
    xiaohongshu_en: [
      `AI Entrepreneur's Guide\nIf you're serious about building a unicorn, ${input.keywords[0]} should be your priority. Here's why...`,
      `The Secret to Scaling\nMost entrepreneurs miss this crucial step about ${input.keywords[0]}...`,
      `CEO Tips & Tricks\nUsing ${input.keywords[0]} helped us reach $1B valuation faster. Let me share...`,
    ],
  };

  const key = `${input.platform}_${input.language}` as keyof typeof mockCaptions;
  const captions = mockCaptions[key] || mockCaptions.facebook_en;

  const mockHashtags = [
    '#AI', '#创业', '#内容运营',
    '#企业家', '#科技',
  ];

  return {
    captions: captions.slice(0, 3),
    hashtags: mockHashtags.slice(0, 5),
    cost_usd: 0.001, // Mock cost
    tokens_used: 150,
  };
}
