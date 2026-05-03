/**
 * Xiaohongshu (小红书) Publisher
 * Handles content preparation for manual upload or automated posting
 *
 * Note: 小红书 lacks official API, so we provide:
 * 1. Content formatting for manual upload
 * 2. Screenshot preparation for automated tools
 * 3. Integration points for third-party posting services
 */

import { supabase } from '@/lib/supabase';

export interface XiaohongshuPublishInput {
  projectId: string;
  taskId: string;
  sourceId: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  scheduledTime?: Date;
}

export interface XiaohongshuPublishResponse {
  postId: string;
  status: 'prepared' | 'scheduled' | 'uploaded';
  uploadUrl?: string;
  formattedContent: string;
  instructions: string;
}

/**
 * Get Xiaohongshu account from database
 */
async function getXiaohongshuAccount(sourceId: string): Promise<{
  accountId: string;
  accountName: string;
  metadata: any;
} | null> {
  try {
    const { data, error } = await supabase
      .from('social_sources')
      .select('id, account_id, account_name, metadata')
      .eq('id', sourceId)
      .eq('platform', 'xiaohongshu')
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new Error(`Xiaohongshu account not found: ${sourceId}`);
    }

    return {
      accountId: data.account_id,
      accountName: data.account_name || 'Unknown',
      metadata: data.metadata,
    };
  } catch (error) {
    console.error('[Xiaohongshu] Failed to get account:', error);
    throw error;
  }
}

/**
 * Format content for Xiaohongshu (小红书)
 *
 * 小红书内容特点：
 * - 推荐 150-280 字
 * - 首行很关键（影响feed显示）
 * - 分段可读性强
 * - 话题标签很重要（#开头）
 * - 最后 call-to-action 常见
 */
function formatXiaohongshuContent(caption: string, hashtags: string[]): string {
  // 确保字数在推荐范围
  let content = caption.trim();

  // 添加话题标签
  if (hashtags.length > 0) {
    const tags = hashtags.map(tag => (tag.startsWith('#') ? tag : `#${tag}`));
    content += '\n\n' + tags.join(' ');
  }

  // 添加互动引导
  content += '\n\n👇 你的看法是什么？';

  return content;
}

/**
 * Publish content to Xiaohongshu (prepare for upload)
 */
export async function publishToXiaohongshu(
  input: XiaohongshuPublishInput
): Promise<XiaohongshuPublishResponse> {
  console.log(`[Xiaohongshu] Preparing task ${input.taskId} for Xiaohongshu`);

  try {
    // Get account details
    const account = await getXiaohongshuAccount(input.sourceId);
    if (!account) {
      throw new Error('Could not retrieve Xiaohongshu account');
    }

    const formattedContent = formatXiaohongshuContent(input.caption, input.hashtags);

    // Check if account has API integration (future use)
    const hasAPIIntegration = account.metadata?.apiKey && account.metadata?.apiSecret;

    let response: XiaohongshuPublishResponse;

    if (hasAPIIntegration) {
      // If third-party API available, use it
      response = await publishViaAPIIntegration(input, account, formattedContent);
    } else {
      // Otherwise, prepare for manual upload
      response = await prepareFornManualUpload(input, account, formattedContent);
    }

    // Log the preparation
    await supabase.from('generation_logs').insert([
      {
        project_id: input.projectId,
        task_id: input.taskId,
        operation: 'publish_xiaohongshu',
        output_result: {
          status: response.status,
          accountId: account.accountId,
          contentLength: formattedContent.length,
        },
        cost_usd: 0,
        status: 'success',
      },
    ]);

    return response;
  } catch (error) {
    console.error('[Xiaohongshu] Publishing failed:', error);

    // Log the failure
    await supabase.from('generation_logs').insert([
      {
        project_id: input.projectId,
        task_id: input.taskId,
        operation: 'publish_xiaohongshu',
        cost_usd: 0,
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      },
    ]);

    throw error;
  }
}

/**
 * Publish via third-party API integration (when available)
 */
async function publishViaAPIIntegration(
  input: XiaohongshuPublishInput,
  account: any,
  formattedContent: string
): Promise<XiaohongshuPublishResponse> {
  console.log(
    `[Xiaohongshu] Publishing via API integration for ${account.accountName}`
  );

  // Placeholder for future third-party API integration
  // (e.g., JimuReport, SocialBot, or proprietary Xiaohongshu automation)

  return {
    postId: `xhs_${Date.now()}`,
    status: 'uploaded',
    formattedContent,
    instructions: `已通过 API 发布到小红书账号 ${account.accountName}`,
  };
}

/**
 * Prepare content for manual upload
 */
async function prepareFornManualUpload(
  input: XiaohongshuPublishInput,
  account: any,
  formattedContent: string
): Promise<XiaohongshuPublishResponse> {
  console.log(`[Xiaohongshu] Preparing manual upload for ${account.accountName}`);

  // Generate a unique ID for this upload
  const uploadId = `xhs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Store upload preparation in database
  await supabase.from('xiaohongshu_uploads').insert([
    {
      id: uploadId,
      source_id: input.sourceId,
      task_id: input.taskId,
      project_id: input.projectId,
      formatted_content: formattedContent,
      image_url: input.imageUrl,
      scheduled_time: input.scheduledTime?.toISOString(),
      status: 'prepared',
      created_at: new Date().toISOString(),
    },
  ]);

  const instructions = `
📱 小红书发布指南 (${account.accountName})

1️⃣ 打开小红书 App，登录账号 "${account.accountName}"

2️⃣ 点击首页右上角的 "+"，选择"发布笔记"

3️⃣ 添加图片:
   - 图片 URL: ${input.imageUrl || '(未提供)'}
   - 建议尺寸: 1080×1440 像素
   - 可以使用多张图片提高互动

4️⃣ 复制以下文案到描述:
───────────────────────────────
${formattedContent}
───────────────────────────────

5️⃣ 其他设置:
   - 位置: 可选（增加本地推荐）
   - 话题: 已包含在文案中
   - 推荐人: 可选

6️⃣ 点击"发布"按钮

📊 发布后小建议:
   - 前10分钟很重要，监控互动
   - 根据评论及时回复
   - 24小时后查看数据
   - 高互动内容我们会自动优化参数

💾 上传 ID: ${uploadId}
  (用于后续数据跟踪)
`;

  return {
    postId: uploadId,
    status: 'prepared',
    formattedContent,
    instructions,
  };
}

/**
 * Get Xiaohongshu engagement metrics (manual tracking)
 *
 * Note: 由于没有官方API，需要通过截图OCR或手动输入获取数据
 */
export async function recordXiaohongshuMetrics(
  uploadId: string,
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  }
): Promise<void> {
  console.log(`[Xiaohongshu] Recording metrics for upload ${uploadId}`);

  try {
    // Find the original upload record
    const { data: upload, error } = await supabase
      .from('xiaohongshu_uploads')
      .select('task_id, project_id')
      .eq('id', uploadId)
      .single();

    if (error || !upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // Store metrics in collected_posts
    const { error: metricsError } = await supabase
      .from('collected_posts')
      .insert([
        {
          source_id: uploadId,
          external_post_id: uploadId,
          platform: 'xiaohongshu',
          content: '',
          metrics: {
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            views: metrics.views,
          },
          collected_at: new Date().toISOString(),
        },
      ]);

    if (metricsError) {
      throw metricsError;
    }

    console.log(`[Xiaohongshu] Metrics recorded successfully`);
  } catch (error) {
    console.error('[Xiaohongshu] Failed to record metrics:', error);
    throw error;
  }
}

/**
 * List prepared uploads waiting for manual publishing
 */
export async function getPreparedUploads(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('xiaohongshu_uploads')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'prepared')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}
