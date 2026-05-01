'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

export default function GeoComposerIndexPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      if (res.ok) {
        const json = await res.json();
        setClients(json.clients ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">GEO Composer</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate AI recommendation directives and embed them in client websites.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-gray-200 p-5 h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <Link
              key={client.id}
              href={`/dashboard/geo-composer/${client.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-gray-900 group-hover:text-indigo-700 truncate">
                    {client.name}
                  </h2>
                  {client.domain && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{client.domain}</p>
                  )}
                </div>
                <span className="text-gray-300 group-hover:text-indigo-400 text-lg ml-2 flex-shrink-0">→</span>
              </div>
              <div className="mt-3">
                <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">
                  Open Composer
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
