/**
 * Reusable Component: UrlInput
 *
 * HTTPS-only URL input with real-time validation feedback.
 * Used for entering page URLs for GEO snippet deployment.
 */

'use client';

import React, { useState } from 'react';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';

interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onValidChange?: (isValid: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function UrlInput({
  value,
  onChange,
  onValidChange,
  placeholder = 'https://example.com/page',
  disabled = false,
}: UrlInputProps) {
  const [touched, setTouched] = useState(false);

  const isValid = value.length === 0 || DEPLOYMENT_CONFIG.URL_REGEX.test(value);
  const isError = touched && value.length > 0 && !isValid;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    onValidChange?.(DEPLOYMENT_CONFIG.URL_REGEX.test(newValue) || newValue.length === 0);
  };

  return (
    <div className="w-full">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-4 py-2 border rounded-lg font-mono text-sm text-gray-900 disabled:bg-gray-100 disabled:cursor-not-allowed transition ${
          isError
            ? 'border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500'
            : 'border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500'
        }`}
      />
      {isError && (
        <p className="mt-2 text-sm text-red-600">
          {DEPLOYMENT_CONFIG.ERRORS.INVALID_URL}
        </p>
      )}
    </div>
  );
}
