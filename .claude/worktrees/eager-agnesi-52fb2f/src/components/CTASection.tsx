import Link from 'next/link';

const CTASection = () => {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-gray-900 to-cyan-600/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent_70%)]" />
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to grow your business with{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              AI marketing
            </span>
            ?
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Let&apos;s discuss how our AI marketing infrastructure can help your business reach more customers.
          </p>
          <Link
            href="/contact"
            className="btn-primary px-10 py-4 rounded-lg font-semibold text-white inline-block text-lg"
          >
            Book a Free Consultation
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
