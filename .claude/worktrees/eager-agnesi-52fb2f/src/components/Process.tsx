const Process = () => {
  const steps = [
    {
      icon: '\u{1F3AF}',
      title: 'Strategy',
      description: 'Understand business goals and map out the growth path',
    },
    {
      icon: '\u{1F4D0}',
      title: 'System Design',
      description: 'Architect website, SEO, and AI infrastructure',
    },
    {
      icon: '\u{26A1}',
      title: 'Build',
      description: 'Rapid development with modern tech stack',
    },
    {
      icon: '\u{1F4C8}',
      title: 'Growth',
      description: 'Deploy SEO and AI marketing for continuous growth',
    },
  ];

  return (
    <section className="py-20 section-alt">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <p className="text-blue-400 font-medium text-sm uppercase tracking-wider mb-3">How We Work</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Our Process
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            We follow a systematic approach to deliver results for your business.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
          <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-blue-500/20 via-blue-500/40 to-blue-500/20" />
          {steps.map((step, index) => (
            <div key={index} className="text-center relative z-10">
              <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center text-3xl mx-auto mb-5 shadow-lg shadow-blue-500/5">
                {step.icon}
              </div>
              <div className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-2">
                Step {index + 1}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-gray-400 text-sm">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Process;
