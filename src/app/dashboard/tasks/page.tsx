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

const STATUS_FILTERS = ['all', 'pending', 'generating', 'published', 'completed', 'failed'] as const;

export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [selectedTask, setSelectedTask] = useState<ContentTask | null>(null);
  const limit = 10;

  const { data, loading } = useApi(
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Tasks</h1>

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

            {selectedTask.generated_captions && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-300">Generated Captions</h4>
                {selectedTask.generated_captions.facebook?.zh && (
                  <div className="p-3 bg-gray-700/50 rounded">
                    <p className="text-xs text-blue-400 mb-1">Facebook (中文)</p>
                    <p className="text-sm text-gray-200">{selectedTask.generated_captions.facebook.zh}</p>
                  </div>
                )}
                {selectedTask.generated_captions.xiaohongshu?.zh && (
                  <div className="p-3 bg-gray-700/50 rounded">
                    <p className="text-xs text-red-400 mb-1">小红书 (中文)</p>
                    <p className="text-sm text-gray-200">{selectedTask.generated_captions.xiaohongshu.zh}</p>
                  </div>
                )}
              </div>
            )}

            {selectedTask.image_url && (
              <div>
                <h4 className="text-sm font-semibold text-gray-300 mb-2">Image</h4>
                <img src={selectedTask.image_url} alt="Generated" className="rounded max-h-48 object-cover" />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
