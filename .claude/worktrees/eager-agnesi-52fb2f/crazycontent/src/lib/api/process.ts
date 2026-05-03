/**
 * Trigger task processing manually
 */
export async function triggerProcessing(): Promise<{ processed: number; failed: number }> {
  const res = await fetch('/api/cron/process-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Processing failed');
  }
  return json.data;
}
