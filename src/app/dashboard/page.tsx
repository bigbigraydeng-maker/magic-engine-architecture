'use client';

import Link from 'next/link';
import { useApi } from '@/hooks/use-api';
import { fetchTasks } from '@/lib/api/tasks';
import { fetchTopics } from '@/lib/api/topics';
import { PROJECT_ID } from '@/lib/config';
import { StatsCard } from '@/components/dashboard/stats-card';
import { TaskStatusBadge } from '@/components/dashboard/task-status-badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export default function DashboardPage() {
  const tasks = useApi(() => fetchTasks(PROJECT_ID, { limit: 5 }), []);
  const topics = useApi(() => fetchTopics(PROJECT_ID), []);

  if (tasks.loading || topics.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const taskItems = tasks.data?.items || [];
  const totalTasks = tasks.data?.total || 0;
  const publishedCount = taskItems.filter((t) => t.status === 'published' || t.status === 'completed').length;
  const topicCount = topics.data?.total || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard label="Total Tasks" value={totalTasks} />
        <StatsCard label="Published" value={publishedCount} />
        <StatsCard label="Topics" value={topicCount} />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href="/dashboard/topics">
          <Button variant="secondary">Manage Topics</Button>
        </Link>
        <Link href="/dashboard/generate">
          <Button>Generate Content</Button>
        </Link>
      </div>

      {/* Recent Tasks */}
      <Card title="Recent Tasks">
        {taskItems.length === 0 ? (
          <p className="text-sm text-gray-500">No tasks yet. Generate some content to get started.</p>
        ) : (
          <div className="space-y-3">
            {taskItems.map((task) => (
              <div key={task.id} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
                <div>
                  <p className="text-sm text-gray-200">{task.topic_id ? `Topic: ${task.topic_id.slice(0, 8)}...` : 'No topic'}</p>
                  <p className="text-xs text-gray-500">{new Date(task.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  {task.platforms.map((p) => (
                    <span key={p} className="text-xs text-gray-400">{p}</span>
                  ))}
                  <TaskStatusBadge status={task.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
