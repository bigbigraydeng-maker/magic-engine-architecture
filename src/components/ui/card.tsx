interface CardProps {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Card({ title, children, footer, className = '' }: CardProps) {
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-lg ${className}`}>
      {title && (
        <div className="px-5 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-gray-700 bg-gray-800/50">{footer}</div>
      )}
    </div>
  );
}
