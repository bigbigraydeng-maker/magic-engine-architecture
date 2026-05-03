import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Insights | Magic Lab',
  description: 'Latest trends and best practices in AI marketing and website development.',
};

export default function InsightsPage() {
  const articles = [
    {
      title: 'How Travel Companies Should Build Websites in 2026',
      date: 'March 12, 2026',
      excerpt: 'Learn the latest trends and best practices for travel company websites in 2026.'
    },
    {
      title: 'Why Static Websites Rank Better on Google',
      date: 'March 10, 2026',
      excerpt: 'Discover why static websites are becoming the preferred choice for SEO.'
    },
    {
      title: 'AI SEO vs Traditional SEO',
      date: 'March 8, 2026',
      excerpt: 'Compare the effectiveness of AI-powered SEO strategies versus traditional methods.'
    }
  ];

  return (
    <div className="py-32 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Insights
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Latest trends and best practices in AI marketing and website development.
          </p>
        </div>

        <div className="space-y-8">
          {articles.map((article, index) => (
            <div key={index} className="bg-gray-800 p-8 rounded-xl">
              <h2 className="text-2xl font-semibold text-white mb-2">
                {article.title}
              </h2>
              <p className="text-gray-400 mb-4">{article.date}</p>
              <p className="text-gray-300">{article.excerpt}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}