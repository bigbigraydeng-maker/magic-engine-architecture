/**
 * Reusable Component: DeploymentStatusBadge
 *
 * Status indicator badge showing deployment state (active, pending, revoked).
 * Can be extracted and reused across other pages.
 */

'use client';

interface DeploymentStatusBadgeProps {
  status: 'active' | 'pending' | 'revoked';
  size?: 'sm' | 'md' | 'lg';
}

export function DeploymentStatusBadge({ status, size = 'md' }: DeploymentStatusBadgeProps) {
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  const statusColors = {
    active: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    revoked: 'bg-gray-100 text-gray-500',
  };

  const statusLabels = {
    active: 'Active',
    pending: 'Pending',
    revoked: 'Revoked',
  };

  return (
    <span className={`inline-block rounded-full font-medium ${sizeClasses[size]} ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
