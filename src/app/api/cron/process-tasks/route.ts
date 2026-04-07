/**
 * Vercel Cron Job: Process Pending Content Generation Tasks
 *
 * Schedule: Every 5 minutes
 * Endpoint: POST /api/cron/process-tasks
 *
 * This cron job:
 * 1. Fetches pending tasks due for processing
 * 2. Generates content for each task
 * 3. Updates task status with generated content
 * 4. Logs the generation operation with cost
 * 5. Handles errors gracefully
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPendingTasks, updateTask } from '@/lib/db/tasks';
import { getTopics } from '@/lib/db/topics';
import { logGeneration } from '@/lib/db/logs';
import { generateCaptions, generateCaptionsMock } from '@/lib/ai/generate';
import { supabaseAdmin as supabase } from '@/lib/supabase';

/**
 * Verify request is from Render background service or authorized source
 *
 * Supports:
 * - PROCESS_TASKS_SECRET (Render background service)
 * - CRON_SECRET (Vercel, fallback)
 */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const processTasksSecret = process.env.PROCESS_TASKS_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const secret = processTasksSecret || cronSecret;

  if (!secret) {
    console.warn('[CRON] No secret configured, allowing all requests (dev mode)');
    return true;
  }

  // Allow requests without auth header (browser "Process Now" button)
  if (!authHeader) {
    console.log('[CRON] No auth header, allowing (manual trigger)');
    return true;
  }

  const isValid = authHeader === `Bearer ${secret}`;
  if (!isValid) {
    console.error('[CRON] Invalid authorization token');
  }
  return isValid;
}

export async function POST(request: NextRequest) {
  console.log('[CRON] Processing tasks started');
  const startTime = Date.now();

  // Verify cron request
  if (!verifyCronSecret(request)) {
    console.error('[CRON] Unauthorized cron request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    // Fetch pending tasks
    const pendingTasks = await getPendingTasks(10);
    console.log(`[CRON] Found ${pendingTasks.length} pending tasks`);

    if (pendingTasks.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          processed: 0,
          failed: 0,
          totalCost: 0,
        },
      });
    }

    let processedCount = 0;
    let failedCount = 0;
    let totalCost = 0;

    // Process each task
    for (const task of pendingTasks) {
      try {
        console.log(`[CRON] Processing task ${task.id}`);

        // Get topic details
        if (!task.topic_id) {
          console.warn(`[CRON] Task ${task.id} has no topic_id, skipping`);
          failedCount++;
          continue;
        }

        const topics = await getTopics(task.project_id);
        const topic = topics.find(t => t.id === task.topic_id);

        if (!topic) {
          console.error(`[CRON] Topic ${task.topic_id} not found for task ${task.id}`);
          await updateTask(task.project_id, task.id, {
            status: 'failed',
            error_message: 'Topic not found',
          });
          failedCount++;
          continue;
        }

        // Mark as generating
        await updateTask(task.project_id, task.id, {
          status: 'generating',
        });

        // Generate captions for each platform
        const generatedCaptions: Record<string, Record<string, string>> = {};
        let taskCost = 0;

        for (const platform of task.platforms) {
          try {
            // Use mock generation if in development
            const useMock = process.env.ENABLE_REAL_GENERATION === 'false';
            console.log(
              `[CRON] Generating captions for ${platform}${useMock ? ' (mock)' : ''}`
            );

            const result = useMock
              ? await generateCaptionsMock({
                  topic: topic.name,
                  keywords: topic.keywords,
                  targetAudience: topic.target_audience,
                  tone: topic.tone,
                  platform: platform as 'facebook' | 'xiaohongshu',
                  language: 'zh', // Default to Chinese
                })
              : await generateCaptions({
                  topic: topic.name,
                  keywords: topic.keywords,
                  targetAudience: topic.target_audience,
                  tone: topic.tone,
                  platform: platform as 'facebook' | 'xiaohongshu',
                  language: 'zh',
                });

            // Store first caption as primary
            generatedCaptions[platform] = {
              zh: result.captions[0] || '',
              hashtags: result.hashtags.join(' '),
            };

            taskCost += result.cost_usd;
            console.log(`[CRON] Generated captions for ${platform}, cost: $${result.cost_usd}`);
          } catch (error) {
            console.error(`[CRON] Failed to generate captions for ${platform}:`, error);
            generatedCaptions[platform] = {
              zh: `[Generation failed for ${platform}]`,
              hashtags: '',
            };
          }
        }

        // Update task with generated content
        await updateTask(task.project_id, task.id, {
          status: 'completed',
          generated_captions: generatedCaptions,
        });

        // Log the generation
        await logGeneration({
          project_id: task.project_id,
          task_id: task.id,
          operation: 'generate_copy',
          input_prompt: {
            topic: topic.name,
            keywords: topic.keywords,
            platforms: task.platforms,
          },
          output_result: generatedCaptions,
          cost_usd: taskCost,
          duration_ms: Date.now() - startTime,
          status: 'success',
        });

        totalCost += taskCost;
        processedCount++;
        console.log(`[CRON] Task ${task.id} processed successfully`);
      } catch (error) {
        console.error(`[CRON] Error processing task ${task.id}:`, error);

        try {
          // Log the failure
          await updateTask(task.project_id, task.id, {
            status: 'failed',
            error_message:
              error instanceof Error ? error.message : 'Unknown error',
          });

          await logGeneration({
            project_id: task.project_id,
            task_id: task.id,
            operation: 'generate_copy',
            cost_usd: 0,
            duration_ms: Date.now() - startTime,
            status: 'failed',
            error_message:
              error instanceof Error ? error.message : 'Unknown error',
          });
        } catch (logError) {
          console.error(`[CRON] Failed to log error for task ${task.id}:`, logError);
        }

        failedCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[CRON] Processing completed. Processed: ${processedCount}, Failed: ${failedCount}, Cost: $${totalCost.toFixed(4)}, Duration: ${duration}ms`
    );

    return NextResponse.json({
      success: true,
      data: {
        processed: processedCount,
        failed: failedCount,
        totalCost: parseFloat(totalCost.toFixed(6)),
        durationMs: duration,
      },
    });
  } catch (error) {
    console.error('[CRON] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Task processor cron endpoint is running',
    timestamp: new Date().toISOString(),
  });
}
