import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Services | Magic Lab',
  description: 'Our comprehensive services include website development, SEO optimization, and AI marketing systems.',
};

export default function ServicesPage() {
  return (
    <div className="py-32 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Our Services
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            We provide comprehensive AI marketing infrastructure to help your business grow online.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="bg-gray-800 p-8 rounded-xl">
            <h2 className="text-2xl font-semibold text-white mb-4">
              Website Development
            </h2>
            <ul className="space-y-2 text-gray-300">
              <li>Fast websites</li>
              <li>Mobile responsive</li>
              <li>SEO architecture</li>
              <li>Hosting and deployment</li>
            </ul>
          </div>

          <div className="bg-gray-800 p-8 rounded-xl">
            <h2 className="text-2xl font-semibold text-white mb-4">
              SEO / GEO Optimization
            </h2>
            <ul className="space-y-2 text-gray-300">
              <li>Keyword research</li>
              <li>SEO structure</li>
              <li>Local SEO</li>
              <li>AI search visibility</li>
            </ul>
          </div>

          <div className="bg-gray-800 p-8 rounded-xl">
            <h2 className="text-2xl font-semibold text-white mb-4">
              AI Marketing Systems
            </h2>
            <ul className="space-y-2 text-gray-300">
              <li>Lead automation</li>
              <li>AI assistants</li>
              <li>Marketing workflows</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}