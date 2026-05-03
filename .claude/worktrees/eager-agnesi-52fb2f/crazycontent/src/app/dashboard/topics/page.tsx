'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { fetchTopics, createTopic } from '@/lib/api/topics';
import { PROJECT_ID } from '@/lib/config';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';

export default function TopicsPage() {
  const { data, loading, refetch } = useApi(() => fetchTopics(PROJECT_ID), []);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [tone, setTone] = useState('professional');
  const [frequency, setFrequency] = useState('1');

  const resetForm = () => {
    setName('');
    setDescription('');
    setKeywords('');
    setTargetAudience('');
    setTone('professional');
    setFrequency('1');
  };

  const handleSubmit = async () => {
    if (!name || !keywords) return;
    setSubmitting(true);
    try {
      await createTopic(PROJECT_ID, {
        name,
        description: description || undefined,
        keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        target_audience: targetAudience || undefined,
        tone,
        frequency_daily: parseInt(frequency) || 1,
      });
      setShowForm(false);
      resetForm();
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create topic');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const topics = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Topics</h1>
        <Button onClick={() => setShowForm(true)}>Add Topic</Button>
      </div>

      {topics.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No topics yet. Create your first topic to start generating content.</p>
            <Button onClick={() => setShowForm(true)}>Create Topic</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {topics.map((topic) => (
            <Card key={topic.id}>
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{topic.name}</h3>
                    {topic.description && (
                      <p className="text-sm text-gray-400 mt-1">{topic.description}</p>
                    )}
                  </div>
                  <Badge variant={topic.enabled ? 'success' : 'default'}>
                    {topic.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topic.keywords.map((kw) => (
                    <Badge key={kw} variant="info">{kw}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>Tone: {topic.tone}</span>
                  <span>{topic.frequency_daily} post/day</span>
                  {topic.target_audience && <span>Audience: {topic.target_audience}</span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Topic Modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); resetForm(); }}
        title="Create New Topic"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={!name || !keywords}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AI Technology Trends" />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this topic" />
          <Input label="Keywords * (comma-separated)" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. AI, machine learning, tech" />
          <Input label="Target Audience" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="e.g. Tech professionals" />
          <Select
            label="Tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            options={[
              { value: 'professional', label: 'Professional' },
              { value: 'casual', label: 'Casual' },
              { value: 'inspirational', label: 'Inspirational' },
            ]}
          />
          <Input label="Posts per day" type="number" value={frequency} onChange={(e) => setFrequency(e.target.value)} min="1" max="10" />
        </div>
      </Modal>
    </div>
  );
}
