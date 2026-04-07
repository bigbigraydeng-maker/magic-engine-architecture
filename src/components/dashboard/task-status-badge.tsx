import { Badge } from '@/components/ui/badge';

const statusConfig: Record<string, { variant: 'success' | 'warning' | 'error' | 'info' | 'default'; pulse?: boolean }> = {
  pending: { variant: 'default' },
  generating: { variant: 'info', pulse: true },
  publishing: { variant: 'warning', pulse: true },
  published: { variant: 'success' },
  completed: { variant: 'success' },
  failed: { variant: 'error' },
};

export function TaskStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { variant: 'default' as const };
  return (
    <Badge variant={config.variant} pulse={config.pulse}>
      {status}
    </Badge>
  );
}
