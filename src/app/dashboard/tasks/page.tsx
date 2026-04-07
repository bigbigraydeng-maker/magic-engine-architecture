'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { fetchTasks } from '@/lib/api/tasks';
import { PROJECT_ID } from '@/lib/config';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TaskStatusBadge } from '@/components/dashboard/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { ContentTask } from '@/types/crazy-content';
import { triggerProcessing } from '@/lib/api/process';

const STATUS_FILTERS = ['all', 'pending', 'generating', 'published', 'completed', 'failed'] as const;

/**
 * Split a multi-caption string into individual captions.
 * Detects patterns like "主文案1:", "主文案2:", "Caption 1:", "Option 1:", etc.
 */
function splitCaptions(text: string): string[] {
  // Try splitting by common multi-caption markers
  const markers = /(?:^|\n)\s*(?:主文案|Caption|Option)\s*\d+\s*[:：]/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Collect all marker positions
  const positions: number[] = [];
  const regex = new RegExp(markers.source, markers.flags);
  while ((match = regex.exec(text)) !== null) {
    positions.push(match.index);
  }

  if (positions.length >= 2) {
    // Split by marker positions
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i];
      const end = i + 1 < positions.length ? positions[i + 1] : text.length;
      const segment = text.slice(start, end).trim();
      if (segment) parts.push(segment);
    }
    // If there was content before the first marker, prepend it
    if (positions[0] > 0) {
      const prefix = text.slice(0, positions[0]).trim();
      if (prefix) parts.unshift(prefix);
    }
    return parts;
  }

  // Fallback: try splitting by numbered lines like "1." "2." "3." at line start
  const numbered = text.split(/\n(?=\d+[\.\)]\s)/);
  if (numbered.length >= 2) return numbered.map(s => s.trim()).filter(Boolean);

  // No splitting possible, return as single caption
  return [text];
}

export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [selectedTask, setSelectedTask] = useState<ContentTask | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const limit = 10;

  const { data, loading, refetch } = useApi(
    () => fetchTasks(PROJECT_ID, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit,
      offset,
    }),
    [statusFilter, offset]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const tasks = data?.items || [];
  const total = data?.total || 0;

  const handleProcess = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const result = await triggerProcessing();
      setProcessResult(`Processed: ${result.processed}, Failed: ${result.failed}`);
      refetch();
    } catch (err) {
      setProcessResult(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <div className="flex items-center gap-3">
          {processResult && (
            <span className={`text-xs ${processResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {processResult}
            </span>
          )}
          <Button onClick={handleProcess} loading={processing} variant="secondary" size="sm">
            Process Now
          </Button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => { setStatusFilter(s); setOffset(0); }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {/* Tasks List */}
      <Card>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No tasks found.</p>
        ) : (
          <div className="divide-y divide-gray-700">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="w-full flex items-center justify-between py-3 px-1 text-left hover:bg-gray-700/30 transition-colors rounded"
              >
                <div className="space-y-1">
                  <p className="text-sm text-gray-200 font-mono">{task.id.slice(0, 12)}...</p>
                  <div className="flex gap-2">
                    {task.platforms.map((p) => (
                      <Badge key={p} variant="default">{p}</Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <TaskStatusBadge status={task.status} />
                  <p className="text-xs text-gray-500">{new Date(task.created_at).toLocaleString()}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Pagination */}
      {total > limit && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-400">Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <Button variant="ghost" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      <Modal
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        title="Task Details"
      >
        {selectedTask && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 font-mono">{selectedTask.id}</p>
              <TaskStatusBadge status={selectedTask.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Platforms</p>
                <div className="flex gap-1 mt-1">
                  {selectedTask.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
                </div>
              </div>
              <div>
                <p className="text-gray-500">Created</p>
                <p className="text-gray-200">{new Date(selectedTask.created_at).toLocaleString()}</p>
              </div>
              {selectedTask.scheduled_at && (
                <div>
                  <p className="text-gray-500">Scheduled</p>
                  <p className="text-gray-200">{new Date(selectedTask.scheduled_at).toLocaleString()}</p>
                </div>
              )}
              {selectedTask.published_at && (
                <div>
                  <p className="text-gray-500">Published</p>
                  <p className="text-gray-200">{new Date(selectedTask.published_at).toLocaleString()}</p>
                </div>
              )}
            </div>

            {selectedTask.error_message && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-sm text-red-300">
                {selectedTask.error_message}
              </div>
            )}

            {/* Unsplash Image */}
            {selectedTask.image_url && (
              <div>
                <h4 className="text-sm font-semibold text-gray-300 mb-2">📷 配图</h4>
                <img
                  src={selectedTask.image_url}
                  alt="Content"
                  className="rounded-lg max-h-64 w-full object-cover border border-gray-600"
                />
                {selectedTask.image_metadata?.photographer && (
                  <p className="text-xs text-gray-500 mt-1">
                    Photo by{' '}
                    <a
                      href={selectedTask.image_metadata.photographer_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {selectedTask.image_metadata.photographer}
                    </a>
                    {' '}on Unsplash
                  </p>
                )}
              </div>
            )}

            {/* Generated Captions — split into individual cards */}
            {selectedTask.generated_captions && (
              <div className="space-y-4">
                {/* Facebook Captions */}
                {selectedTask.generated_captions.facebook?.zh && (() => {
                  const captions = splitCaptions(selectedTask.generated_captions.facebook!.zh!);
                  return (
                    <>
                      <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-1">
                        <span>📘</span> Facebook · {captions.length} 条文案
                      </h4>
                      {captions.map((caption, i) => (
                        <div key={i} className="p-4 bg-gradient-to-br from-blue-900/20 to-gray-800/50 border border-blue-800/30 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-blue-300 bg-blue-900/40 px-2 py-0.5 rounded">
                              文案 {i + 1}
                            </span>
                          </div>
                          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{caption}</p>
                        </div>
                      ))}
                      {selectedTask.generated_captions.facebook!.hashtags && (
                        <div className="px-3 py-2 bg-blue-900/10 rounded border border-blue-800/20">
                          <p className="text-xs text-blue-300">{selectedTask.generated_captions.facebook!.hashtags}</p>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Xiaohongshu Captions */}
                {selectedTask.generated_captions.xiaohongshu?.zh && (() => {
                  const captions = splitCaptions(selectedTask.generated_captions.xiaohongshu!.zh!);
                  return (
                    <>
                      <h4 className="text-sm font-semibold text-red-400 flex items-center gap-1">
                        <span>📕</span> 小红书 · {captions.length} 条文案
                      </h4>
                      {captions.map((caption, i) => (
                        <div key={i} className="p-4 bg-gradient-to-br from-red-900/20 to-gray-800/50 border border-red-800/30 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-red-300 bg-red-900/40 px-2 py-0.5 rounded">
                              文案 {i + 1}
                            </span>
                          </div>
                          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{caption}</p>
                        </div>
                      ))}
                      {selectedTask.generated_captions.xiaohongshu!.hashtags && (
                        <div className="px-3 py-2 bg-red-900/10 rounded border border-red-800/20">
                          <p className="text-xs text-red-300">{selectedTask.generated_captions.xiaohongshu!.hashtags}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
