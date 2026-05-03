'use client';

import { SelectHTMLAttributes, forwardRef } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && <label className="block text-sm font-medium text-gray-300">{label}</label>}
        <select
          ref={ref}
          className={`w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 text-sm
            focus:outline-none focus:ring-2 focus:ring-indigo-500 ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }
);

Select.displayName = 'Select';
