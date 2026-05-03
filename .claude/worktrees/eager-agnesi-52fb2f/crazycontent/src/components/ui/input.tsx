'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && <label className="block text-sm font-medium text-gray-300">{label}</label>}
        <input
          ref={ref}
          className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-gray-200 text-sm
            placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
            ${error ? 'border-red-500' : 'border-gray-600'} ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
