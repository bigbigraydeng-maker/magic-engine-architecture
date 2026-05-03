'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/use-api';
import { fetchTopics } from '@/lib/api/topics';
import { generateContent } from '@/lib/api/generate';
import { PROJECT_ID } from '@/lib/config';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

export default function GeneratePage() {
  const { data: topicsData, loading } = useApi(() => fetchTopics(PROJECT_ID), []);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(['facebook', 'xiaohongshu']));
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ task_ids: string[]; task_count: number; errors?: Array<{ topic_id: string; error: string }> } | null>(null);

  const toggleTopic = (id: string) => {
    const next = new Set(selectedTopics);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedTopics(next);
  };

  const togglePlatform = (p: string) => {
    const next = new Set(platforms);
    next.has(p) ? next.delete(p) : next.add(p);
    setPlatforms(next);
  };

  const handleGenerate = async () => {
    if (selectedTopics.size === 0 || platforms.size === 0) return;
    setGenerating(true);
    setResult(null);
    try {
      const res = await generateContent({
        project_id: PROJECT_ID,
        topic_ids: Array.from(selectedTopics),
        platforms: Array.from(platforms),
      });
      setResult(res);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const topics = topicsData?.items || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Generate Content</h1>

      {topics.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">Create topics first before generating content.</p>
            <Link href="/dashboard/topics">
              <Button>Create Topics</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* Step 1: Select Topics */}
          <Card title="1. Select Topics">
            <div className="space-y-2">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => toggleTopic(topic.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-md border transition-colors text-left
                    ${selectedTopics.has(topic.id)
                      ? 'border-indigo-500 bg-indigo-900/20'
                      : 'border-gray-700 hover:border-gray-600'
                    }`}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-200">{topic.name}</p>
                    <div className="flex gap-1 mt-1">
                      {topic.keywords.slice(0, 3).map((kw) => (
                        <Badge key={kw} variant="default">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center
                    ${selectedTopics.has(topic.id) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-600'}`}
                  >
                    {selectedTopics.has(topic.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Step 2: Select Platforms */}
          <Card title="2. Select Platforms">
            <div className="flex gap-3">
              {['facebook', 'xiaohongshu'].map((p) => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`px-4 py-2 rounded-md border text-sm transition-colors
                    ${platforms.has(p)
                      ? 'border-indigo-500 bg-indigo-900/20 text-indigo-300'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                >
                  {p === 'facebook' ? 'Facebook' : '小红书'}
                </button>
              ))}
            </div>
          </Card>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            loading={generating}
            disabled={selectedTopics.size === 0 || platforms.size === 0}
            size="lg"
          >
            Generate Content ({selectedTopics.size} topic{selectedTopics.size !== 1 ? 's' : ''})
          </Button>

          {/* Result */}
          {result && (
            <Card title="Generation Result">
              <div className="space-y-3">
                <p className="text-sm text-green-400">
                  Created {result.task_count} task{result.task_count !== 1 ? 's' : ''} successfully!
                </p>
                <div className="space-y-1">
                  {result.task_ids.map((id) => (
                    <p key={id} className="text-xs text-gray-400 font-mono">{id}</p>
                  ))}
                </div>
                {result.errors && result.errors.length > 0 && (
                  <div className="p-3 bg-red-900/20 border border-red-800 rounded">
                    <p className="text-sm text-red-300 mb-1">Errors:</p>
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-400">{e.error}</p>
                    ))}
                  </div>
                )}
                <Link href="/dashboard/tasks">
                  <Button variant="secondary" size="sm">View Tasks</Button>
                </Link>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
