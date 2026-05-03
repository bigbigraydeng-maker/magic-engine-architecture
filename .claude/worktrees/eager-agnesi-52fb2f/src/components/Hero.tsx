import Link from 'next/link';

const Hero = () => {
  return (
    <section className="gradient-hero pt-36 pb-24">
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-medium">
            AI-Powered Growth for NZ & APAC Businesses
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            AI Marketing Infrastructure for{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Modern Businesses
            </span>
          </h1>
          <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
            We build fast websites, SEO systems and AI-powered marketing tools that bring you customers.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/contact"
              className="btn-primary px-8 py-3.5 rounded-lg font-semibold text-white"
            >
              Book a Strategy Call
            </Link>
            <Link
              href="/work"
              className="btn-secondary px-8 py-3.5 rounded-lg font-semibold text-white"
            >
              View Our Work
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 max-w-3xl mx-auto">
          {[
            { value: '8+', label: 'Projects Delivered' },
            { value: '6+', label: 'AI Systems Built' },
            { value: '13', label: 'Data Sources' },
            { value: '99%', label: 'Uptime' },
          ].map((stat, index) => (
            <div key={index} className="stat-card rounded-xl p-4 text-center">
              <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-gray-400 text-sm mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Hero;
