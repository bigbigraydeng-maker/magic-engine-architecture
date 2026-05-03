import ServiceCard from './ServiceCard';

const Services = () => {
  const services = [
    {
      icon: '\u{1F310}',
      title: 'Website Systems',
      description: [
        'Fast websites',
        'SEO-ready architecture',
        'Mobile optimized',
        'High performance'
      ],
      accent: 'from-blue-500 to-blue-600',
    },
    {
      icon: '\u{1F50D}',
      title: 'SEO / GEO Optimization',
      description: [
        'Google search optimization',
        'AI search visibility',
        'Local SEO infrastructure',
        'Content strategy'
      ],
      accent: 'from-cyan-500 to-teal-500',
    },
    {
      icon: '\u{1F916}',
      title: 'AI Marketing Systems',
      description: [
        'Lead capture automation',
        'AI assistants',
        'Marketing workflow automation',
        'Data-driven marketing'
      ],
      accent: 'from-violet-500 to-purple-500',
    }
  ];

  return (
    <section className="py-20 section-alt">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <p className="text-blue-400 font-medium text-sm uppercase tracking-wider mb-3">What We Do</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Our Services
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            We provide comprehensive AI marketing infrastructure to help your business grow online.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <ServiceCard
              key={index}
              icon={service.icon}
              title={service.title}
              description={service.description}
              accent={service.accent}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Services;
