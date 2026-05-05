/**
 * Component: DeploymentForm
 *
 * Form for entering a page URL and showing GEO directive snippet.
 * User can copy snippet and click to mark deployment as complete.
 *
 * Reference: ROADMAP.md P7.3.22
 */

'use client';

import React, { useState, useMemo } from 'react';
import { UrlInput } from './UrlInput';
import { CodeSnippetBox } from './CodeSnippetBox';
import { ConfirmDialog } from './ConfirmDialog';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';
import type { GeoDirective } from '@/types/magic-engine';

interface DeploymentFormProps {
  clientId: string;
  directive: GeoDirective | null;
  onDeploymentRecorded?: () => void;
  loading?: boolean;
}

export function DeploymentForm({
  clientId,
  directive,
  onDeploymentRecorded,
  loading = false,
}: DeploymentFormProps) {
  const [pageUrl, setPageUrl] = useState('');
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isSuccess: boolean } | null>(null);

  // Generate snippet from directive
  const snippet = useMemo(() => {
    if (!directive) return '';
    return DEPLOYMENT_CONFIG.SNIPPET_TEMPLATE.replace(
      '{directiveJson}',
      JSON.stringify(directive, null, 2)
    ).replace('{versionId}', directive.id || 'latest');
  }, [directive]);

  const handleRecordDeployment = async () => {
    setIsRecording(true);
    try {
      const res = await fetch(DEPLOYMENT_CONFIG.API.RECORD_DEPLOYMENT(clientId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_url: pageUrl }),
      });

      if (!res.ok) throw new Error(DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED);

      setFeedback({ message: DEPLOYMENT_CONFIG.SUCCESS.DEPLOYMENT_RECORDED, isSuccess: true });
      setPageUrl('');
      setShowConfirm(false);
      onDeploymentRecorded?.();

      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED;
      setFeedback({ message, isSuccess: false });
    } finally {
      setIsRecording(false);
    }
  };

  if (!directive) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-amber-700">
          No active GEO directive found. Create one in the GEO Composer first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Add Page</h3>

        <div className="space-y-4">
          <UrlInput
            value={pageUrl}
            onChange={setPageUrl}
            onValidChange={setIsUrlValid}
            disabled={loading || isRecording}
          />

          <button
            onClick={() => setShowConfirm(true)}
            disabled={!isUrlValid || loading || isRecording || pageUrl.length === 0}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition font-medium"
          >
            {isRecording ? 'Recording...' : DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}
          </button>
        </div>
      </div>

      {/* Snippet Display */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">
          {DEPLOYMENT_CONFIG.LABELS.INSTALL_SNIPPET}
        </h3>

        <div className="space-y-4 text-sm text-gray-600">
          <p>
            1. Copy the snippet below
          </p>
          <p>
            2. Paste it into your page {'<head>'} or {'<body>'} tag
          </p>
          <p>
            3. Click "{DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}" to confirm installation
          </p>
        </div>

        <div className="mt-6">
          <CodeSnippetBox
            code={snippet}
            title="GEO Directive Snippet"
            copyable={true}
          />
        </div>
      </div>

      {/* Feedback Message */}
      {feedback && (
        <div
          className={`p-4 rounded-lg ${
            feedback.isSuccess
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirm Deployment"
        message={`Mark ${pageUrl} as deployed with this GEO directive?`}
        confirmLabel={DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}
        cancelLabel="Cancel"
        onConfirm={handleRecordDeployment}
        onCancel={() => setShowConfirm(false)}
        loading={isRecording}
      />
    </div>
  );
}
