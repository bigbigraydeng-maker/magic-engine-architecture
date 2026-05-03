const variants = {
  success: 'bg-green-900/50 text-green-400 border-green-700',
  warning: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  error: 'bg-red-900/50 text-red-400 border-red-700',
  info: 'bg-blue-900/50 text-blue-400 border-blue-700',
  default: 'bg-gray-700 text-gray-300 border-gray-600',
} as const;

interface BadgeProps {
  variant?: keyof typeof variants;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}

export function Badge({ variant = 'default', children, pulse, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
        ${variants[variant]} ${className}`}
    >
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />}
      {children}
    </span>
  );
}
