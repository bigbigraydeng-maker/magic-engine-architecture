'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApi } from '@/hooks/use-api';
import { fetchTasks } from '@/lib/api/tasks';
import { searchImages, searchImagesByQuery, saveImageToTask, UnsplashImageResult } from '@/lib/api/images';
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
 * Detects: "主文案1:", "Caption 1:", "Option 1:", or **bold hooks** as separators
 */
function splitCaptions(text: string): string[] {
  // Pattern 1: "主文案N:" / "Caption N:" / "Option N:"
  const labelRegex = /(?:^|\n)\s*(?:主文案|Caption|Option)\s*\d+\s*[:：]/gi;
  const positions: number[] = [];
  let match: RegExpExecArray | null;
  const re1 = new RegExp(labelRegex.source, labelRegex.flags);
  while ((match = re1.exec(text)) !== null) positions.push(match.index);

  if (positions.length >= 2) {
    const parts: string[] = [];
    for (let i = 0; i < positions.length; i++) {
      const end = i + 1 < positions.length ? positions[i + 1] : text.length;
      const seg = text.slice(positions[i], end).trim();
      if (seg) parts.push(seg);
    }
    return parts;
  }

  // Pattern 2: Multiple paragraphs starting with **bold hook**
  const boldParts = text.split(/\n(?=\*\*[^*]+\*\*)/);
  if (boldParts.length >= 2) {
    return boldParts.map(s => s.trim()).filter(s => s.length > 30);
  }

  // Pattern 3: Numbered lines "1." "2." "3."
  const numbered = text.split(/\n(?=\d+[\.\)]\s)/);
  if (numbered.length >= 2) return numbered.map(s => s.trim()).filter(Boolean);

  return [text];
}

// ─── Image Picker Component ────────────────────────────────────────────────
interface ImagePickerProps {
  task: ContentTask;
  onImageSaved: () => void;
}

function ImagePicker({ task, onImageSaved }: ImagePickerProps) {
  const [images, setImages] = useState<UnsplashImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<UnsplashImageResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');

  // Auto-search on mount based on task content
  const autoSearch = useCallback(async () => {
    setLoading(true);
    try {
      // Extract topic keywords from generated captions
      const captionText = task.generated_captions?.facebook?.zh
        || task.generated_captions?.xiaohongshu?.zh
        || '';
      // Use first 50 chars as a hint, or fallback to platform
      const hint = captionText.replace(/[#\*\[\]]/g, '').slice(0, 50).trim();
      const platform = task.platforms[0] as 'facebook' | 'xiaohongshu';

      const results = await searchImagesByQuery(
        hint || 'business technology',
        platform
      );
      setImages(results);
      setSearchedQuery(hint || 'business technology');
    } catch (err) {
      console.error('Auto image search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [task]);

  useEffect(() => {
    autoSearch();
  }, [autoSearch]);

  const handleCustomSearch = async () => {
    if (!customQuery.trim()) return;
    setLoading(true);
    setSelectedImage(null);
    try {
      const platform = task.platforms[0] as 'facebook' | 'xiaohongshu';
      const results = await searchImagesByQuery(customQuery.trim(), platform);
      setImages(results);
      setSearchedQuery(customQuery.trim());
    } catch (err) {
      console.error('Custom search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedImage) return;
    setSaving(true);
    try {
      await saveImageToTask({
        task_id: task.id,
        project_id: task.project_id,
        image_url: selectedImage.url,
        download_url: selectedImage.downloadUrl,
        photographer: selectedImage.photographer,
        photographer_url: selectedImage.photographerUrl,
      });
      setSaved(true);
      onImageSaved();
    } catch (err) {
      console.error('Failed to save image:', err);
    } finally {
      setSaving(false);
    }
  };

  // Already has an image saved
  if (task.image_url) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-2">📷 已选配图</h4>
        <img
          src={task.image_url}
          alt="Selected"
          className="rounded-lg max-h-64 w-full object-cover border border-gray-600"
        />
        {task.image_metadata?.photographer && (
          <p className="text-xs text-gray-500 mt-1">
            Photo by{' '}
            <a
              href={task.image_metadata.photographer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {task.image_metadata.photographer}
            </a>
            {' '}on Unsplash
          </p>
        )}
      </div>
    );
  }

  // Image saved just now
  if (saved && selectedImage) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-green-400 mb-2">✅ 配图已保存</h4>
        <img
          src={selectedImage.url}
          alt="Selected"
          className="rounded-lg max-h-64 w-full object-cover border border-green-600"
        />
        <p className="text-xs text-gray-500 mt-1">
          Photo by {selectedImage.photographer} on Unsplash
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-300">📷 选择配图</h4>

      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customQuery}
          onChange={(e) => setCustomQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCustomSearch()}
          placeholder="输入关键词搜索图片..."
          className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <Button size="sm" variant="secondary" onClick={handleCustomSearch} loading={loading}>
          搜索
        </Button>
      </div>

      {searchedQuery && (
        <p className="text-xs text-gray-500">
          搜索: &quot;{searchedQuery}&quot; · {images.length} 张结果
        </p>
      )}

      {/* Image grid */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Spinner size="md" />
        </div>
      ) : images.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">未找到图片，试试其他关键词</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <button
              key={img.id}
              onClick={() => setSelectedImage(selectedImage?.id === img.id ? null : img)}
              className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                selectedImage?.id === img.id
                  ? 'border-blue-500 ring-2 ring-blue-500/30 scale-[1.02]'
                  : 'border-transparent hover:border-gray-500'
              }`}
            >
              <img
                src={img.thumb}
                alt={img.alt}
                className="w-full h-28 object-cover"
              />
              {/* Photographer overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] text-white truncate">{img.photographer}</p>
              </div>
              {/* Selected checkmark */}
              {selectedImage?.id === img.id && (
                <div className="absolute top-1.5 right-1.5 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Selected image preview + confirm */}
      {selectedImage && (
        <div className="p-3 bg-gray-700/50 rounded-lg border border-gray-600 space-y-2">
          <div className="flex items-center gap-3">
            <img src={selectedImage.thumb} alt="" className="w-16 h-16 rounded object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{selectedImage.alt}</p>
              <p className="text-xs text-gray-500">
                by {selectedImage.photographer} · {selectedImage.width}x{selectedImage.height}
              </p>
            </div>
            <Button size="sm" variant="primary" onClick={handleConfirm} loading={saving}>
              确认选择
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Tasks Page ────────────────────────────────────────────────────────

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

  const handleImageSaved = () => {
    // Refresh task list to reflect saved image
    refetch();
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
                    {task.image_url && (
                      <Badge variant="default">
                        <span className="text-green-400">📷</span>
                      </Badge>
                    )}
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
        size="xl"
      >
        {selectedTask && (
          <div className="space-y-5">
            {/* Header */}
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
            </div>

            {selectedTask.error_message && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-sm text-red-300">
                {selectedTask.error_message}
              </div>
            )}

            {/* Two-column layout: Captions + Image picker */}
            {selectedTask.status === 'completed' && selectedTask.generated_captions && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Left: Captions */}
                <div className="space-y-3">
                  {/* Facebook */}
                  {selectedTask.generated_captions.facebook?.zh && (() => {
                    const captions = splitCaptions(selectedTask.generated_captions.facebook!.zh!);
                    return (
                      <>
                        <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-1">
                          📘 Facebook · {captions.length} 条文案
                        </h4>
                        {captions.map((caption, i) => (
                          <div key={i} className="p-3 bg-gradient-to-br from-blue-900/20 to-gray-800/50 border border-blue-800/30 rounded-lg">
                            <span className="text-xs font-medium text-blue-300 bg-blue-900/40 px-2 py-0.5 rounded">
                              文案 {i + 1}
                            </span>
                            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed mt-2">{caption}</p>
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

                  {/* Xiaohongshu */}
                  {selectedTask.generated_captions.xiaohongshu?.zh && (() => {
                    const captions = splitCaptions(selectedTask.generated_captions.xiaohongshu!.zh!);
                    return (
                      <>
                        <h4 className="text-sm font-semibold text-red-400 flex items-center gap-1 mt-4">
                          📕 小红书 · {captions.length} 条文案
                        </h4>
                        {captions.map((caption, i) => (
                          <div key={i} className="p-3 bg-gradient-to-br from-red-900/20 to-gray-800/50 border border-red-800/30 rounded-lg">
                            <span className="text-xs font-medium text-red-300 bg-red-900/40 px-2 py-0.5 rounded">
                              文案 {i + 1}
                            </span>
                            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed mt-2">{caption}</p>
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

                {/* Right: Image Picker */}
                <div>
                  <ImagePicker task={selectedTask} onImageSaved={handleImageSaved} />
                </div>
              </div>
            )}

            {/* Non-completed tasks: show captions only */}
            {selectedTask.status !== 'completed' && selectedTask.generated_captions && (
              <div className="space-y-3">
                {selectedTask.generated_captions.facebook?.zh && (
                  <div className="p-3 bg-gray-700/50 rounded">
                    <p className="text-xs text-blue-400 mb-1">Facebook</p>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{selectedTask.generated_captions.facebook.zh}</p>
                  </div>
                )}
                {selectedTask.generated_captions.xiaohongshu?.zh && (
                  <div className="p-3 bg-gray-700/50 rounded">
                    <p className="text-xs text-red-400 mb-1">小红书</p>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{selectedTask.generated_captions.xiaohongshu.zh}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
