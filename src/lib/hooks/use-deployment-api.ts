/**
 * Custom Hook: useDeploymentApi
 *
 * Encapsulates all deployment API logic: fetching deployments, recording new ones,
 * and revoking existing deployments. Handles error messages, loading states, and
 * provides consistent error handling.
 *
 * Reference: ROADMAP.md P7.3.21-23, CLAUDE.md §七
 */

import { useState, useCallback } from 'react';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';

export interface Deployment {
  id: string;
  page_url: string;
  deployed_at: string;
  deployed_by?: string;
  status: 'active' | 'revoked';
}

interface UseDeploymentApiReturn {
  deployments: Deployment[];
  loading: boolean;
  error: string | null;
  fetchDeployments: (clientId: string) => Promise<void>;
  recordDeployment: (clientId: string, pageUrl: string) => Promise<boolean>;
  revokeDeployment: (clientId: string, deploymentId: string) => Promise<boolean>;
  clearError: () => void;
}

export function useDeploymentApi(): UseDeploymentApiReturn {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchDeployments = useCallback(async (clientId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(DEPLOYMENT_CONFIG.API.LIST_DEPLOYMENTS(clientId));
      if (!res.ok) throw new Error(DEPLOYMENT_CONFIG.ERRORS.FETCH_FAILED);
      const data = await res.json();
      setDeployments(data.deployments ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : DEPLOYMENT_CONFIG.ERRORS.FETCH_FAILED;
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const recordDeployment = useCallback(async (clientId: string, pageUrl: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(DEPLOYMENT_CONFIG.API.RECORD_DEPLOYMENT(clientId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_url: pageUrl }),
      });
      if (!res.ok) throw new Error(DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED);
      const data = await res.json();
      // Optimistically add to list
      if (data.deployment) {
        setDeployments(prev => [data.deployment, ...prev]);
      }
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED;
      setError(message);
      return false;
    }
  }, []);

  const revokeDeployment = useCallback(async (clientId: string, deploymentId: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(DEPLOYMENT_CONFIG.API.REVOKE_DEPLOYMENT(clientId, deploymentId), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(DEPLOYMENT_CONFIG.ERRORS.REVOKE_FAILED);
      // Optimistically remove from list
      setDeployments(prev => prev.filter(d => d.id !== deploymentId));
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : DEPLOYMENT_CONFIG.ERRORS.REVOKE_FAILED;
      setError(message);
      return false;
    }
  }, []);

  return {
    deployments,
    loading,
    error,
    fetchDeployments,
    recordDeployment,
    revokeDeployment,
    clearError,
  };
}
