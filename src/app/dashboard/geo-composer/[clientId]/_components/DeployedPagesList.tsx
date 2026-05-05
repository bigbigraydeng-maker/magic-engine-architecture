/**
 * Component: DeployedPagesList
 *
 * Shows list of pages where GEO directive has been deployed.
 * Allows users to view deployment history and revoke deployments.
 *
 * Reference: ROADMAP.md P7.3.23
 */

'use client';

import React, { useState } from 'react';
import { DeploymentStatusBadge } from './DeploymentStatusBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';
import type { Deployment } from '@/lib/hooks/use-deployment-api';

interface DeployedPagesListProps {
  clientId: string;
  deployments: Deployment[];
  loading?: boolean;
  onRevoke?: (deploymentId: string) => Promise<boolean>;
}

export function DeployedPagesList({
  clientId,
  deployments,
  loading = false,
  onRevoke,
}: DeployedPagesListProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null);

  const handleRevokeClick = (deployment: Deployment) => {
    setSelectedDeployment(deployment);
    setShowConfirm(true);
  };

  const handleConfirmRevoke = async () => {
    if (!selectedDeployment || !onRevoke) return;

    setRevoking(selectedDeployment.id);
    const success = await onRevoke(selectedDeployment.id);
    setRevoking(null);

    if (success) {
      setShowConfirm(false);
      setSelectedDeployment(null);
    }
  };

  if (deployments.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-600">No deployed pages yet</p>
        <p className="text-sm text-gray-500 mt-2">
          Add pages above to track your GEO directive deployments
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {deployments.map((deployment) => (
          <div
            key={deployment.id}
            className="flex justify-between items-center p-4 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition"
          >
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm text-blue-600 truncate hover:text-blue-800">
                {deployment.page_url}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Deployed {new Date(deployment.deployed_at).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-3 ml-4">
              <DeploymentStatusBadge status={deployment.status} />

              {deployment.status === 'active' && (
                <button
                  onClick={() => handleRevokeClick(deployment)}
                  disabled={loading || revoking === deployment.id}
                  className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {revoking === deployment.id ? 'Revoking...' : DEPLOYMENT_CONFIG.LABELS.REVOKE}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm && selectedDeployment !== null}
        title="Revoke Deployment"
        message={`Stop using GEO directive on ${selectedDeployment?.page_url}? This won't delete the deployed snippet, but it will no longer receive updates.`}
        confirmLabel={DEPLOYMENT_CONFIG.LABELS.REVOKE}
        cancelLabel="Cancel"
        onConfirm={handleConfirmRevoke}
        onCancel={() => {
          setShowConfirm(false);
          setSelectedDeployment(null);
        }}
        loading={revoking !== null}
        destructive
      />
    </>
  );
}
