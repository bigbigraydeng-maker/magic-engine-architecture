/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';
import { projects } from '../../data/projects';

export const metadata: Metadata = {
  title: 'Work | Magic Lab',
  description: 'Our case studies show how we\'ve helped businesses grow with AI marketing infrastructure.',
};

export default function WorkPage() {
  return (
    <div className="py-32 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <p className="text-blue-400 font-medium text-sm uppercase tracking-wider mb-3">Portfolio</p>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Our Work
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            See how we&apos;ve helped businesses grow with our AI marketing infrastructure.
          </p>
        </div>

        <div className="space-y-16">
          {projects.map((caseStudy, index) => (
            <div
              key={index}
              className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-8 items-center`}
            >
              {caseStudy.image ? (
                <div className="lg:w-1/2 w-full">
                  <div className="rounded-xl overflow-hidden border border-gray-700/50 shadow-2xl shadow-blue-500/5">
                    <img
                      src={caseStudy.image}
                      alt={`${caseStudy.client} project screenshot`}
                      className="w-full h-auto object-cover"
                    />
                  </div>
                </div>
              ) : (
                <div className="lg:w-1/2 w-full">
                  <div className="rounded-xl overflow-hidden bg-gradient-to-br from-gray-800 to-gray-700 h-64 flex items-center justify-center border border-gray-700/50">
                    <span className="text-6xl text-gray-500 font-bold">{caseStudy.client.charAt(0)}</span>
                  </div>
                </div>
              )}
              <div className="lg:w-1/2 w-full">
                <h2 className="text-2xl font-semibold text-white mb-3">
                  {caseStudy.client}
                </h2>
                <p className="text-gray-300 mb-5 leading-relaxed">
                  {caseStudy.description}
                </p>
                <div className="mb-5">
                  <h3 className="text-white font-medium mb-2 text-sm uppercase tracking-wider">Services</h3>
                  <ul className="flex flex-wrap gap-2">
                    {caseStudy.services.map((service, i) => (
                      <li key={i} className="bg-blue-500/15 text-blue-400 border border-blue-500/20 px-3 py-1 rounded-full text-sm">
                        {service}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/40">
                  <h3 className="text-white font-medium mb-1 text-sm uppercase tracking-wider">Results</h3>
                  <p className="text-gray-300 text-sm">
                    {caseStudy.results}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
