import { Card } from '@/components/ui/card';

interface StatsCardProps {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down'; text: string };
}

export function StatsCard({ label, value, trend }: StatsCardProps) {
  return (
    <Card>
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {trend && (
        <p className={`text-xs mt-1 ${trend.direction === 'up' ? 'text-green-400' : 'text-red-400'}`}>
          {trend.direction === 'up' ? '↑' : '↓'} {trend.text}
        </p>
      )}
    </Card>
  );
}
