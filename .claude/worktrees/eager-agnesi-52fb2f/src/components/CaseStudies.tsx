import Link from 'next/link';
import CaseCard from './CaseCard';
import { featuredProjects } from '../data/projects';

const CaseStudies = () => {
  return (
    <section className="py-20 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <p className="text-blue-400 font-medium text-sm uppercase tracking-wider mb-3">Our Work</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Case Studies
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            See how we&apos;ve helped businesses grow with our AI marketing infrastructure.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredProjects.map((caseStudy, index) => (
            <CaseCard
              key={index}
              client={caseStudy.client}
              description={caseStudy.summary}
              image={caseStudy.image}
            />
          ))}
        </div>
        <div className="text-center mt-12">
          <Link
            href="/work"
            className="btn-secondary px-8 py-3 rounded-lg font-semibold text-white inline-block"
          >
            View All Work
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CaseStudies;
