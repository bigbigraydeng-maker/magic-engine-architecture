/**
 * Background Task Processor for Render
 *
 * Runs continuously on Render background service
 * Checks for pending tasks every 5 minutes
 *
 * Start with: npm run process-tasks
 */

const https = require('https');

const PROCESS_INTERVAL = 5 * 60 * 1000; // 5 minutes
const API_ENDPOINT = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const PROCESS_TASKS_ENDPOINT = `${API_ENDPOINT}/api/cron/process-tasks`;
const PROCESS_TASKS_SECRET = process.env.PROCESS_TASKS_SECRET || process.env.CRON_SECRET || '';

console.log(`[Task Processor] Starting with interval: ${PROCESS_INTERVAL / 1000}s`);
console.log(`[Task Processor] Endpoint: ${PROCESS_TASKS_ENDPOINT}`);

/**
 * Call the task processing endpoint
 */
async function processTasks() {
  return new Promise((resolve) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROCESS_TASKS_SECRET}`,
      },
    };

    const req = https.request(PROCESS_TASKS_ENDPOINT, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`[${new Date().toISOString()}] Task processing complete:`, {
            processed: result.data?.processed || 0,
            failed: result.data?.failed || 0,
            cost: result.data?.totalCost || 0,
          });
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Failed to parse response:`, error);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Request error:`, error.message);
      resolve();
    });

    req.setTimeout(120000, () => {
      console.warn(`[${new Date().toISOString()}] Request timeout`);
      req.destroy();
      resolve();
    });

    req.end();
  });
}

/**
 * Main loop
 */
async function main() {
  console.log(`[${new Date().toISOString()}] Task processor started`);

  // Process immediately on startup
  await processTasks();

  // Then process every 5 minutes
  setInterval(async () => {
    await processTasks();
  }, PROCESS_INTERVAL);
}

// Start the processor
main().catch((error) => {
  console.error('[Task Processor] Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Task Processor] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Task Processor] Received SIGINT, shutting down gracefully');
  process.exit(0);
});
