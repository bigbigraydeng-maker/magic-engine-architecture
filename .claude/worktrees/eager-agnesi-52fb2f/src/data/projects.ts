export interface Project {
  client: string;
  description: string;
  summary: string[];
  services: string[];
  results: string;
  featured: boolean;
  image?: string;
}

export const projects: Project[] = [
  {
    client: 'AUCompass',
    description:
      'Brisbane Chinese community real estate data platform with AI-powered property analysis, multi-source data aggregation, and RAG-based intelligent Q&A.',
    summary: [
      'AI property analysis platform',
      'Multi-source data aggregation',
      'RAG-based intelligent Q&A',
    ],
    services: [
      'AI Development',
      'Data Infrastructure',
      'Web Scraping',
      'Full-Stack Development',
    ],
    results:
      'Covers 7 key suburbs with real-time transaction data, school ratings, flood risk, rental yields, and development insights.',
    featured: true,
    image: '/images/projects/aucompass.jpg',
  },
  {
    client: 'StockQueen',
    description:
      'AI-driven US stock quantitative rotation system with a 9-factor scoring engine, scanning 1,500+ stocks weekly and auto-adapting across 4 market regimes.',
    summary: [
      'AI quantitative trading system',
      '9-factor scoring engine',
      'Automated portfolio management',
    ],
    services: [
      'AI Development',
      'Quantitative Analysis',
      'Data Pipeline',
      'Automation',
    ],
    results:
      'Walk-forward validated with average OOS Sharpe ratio of 3.84 across 5 windows, 107% improvement over previous version.',
    featured: true,
    image: '/images/projects/stockqueen.jpg',
  },
  {
    client: 'Yellow Book',
    description:
      'NZ public sentiment and political mood index platform, collecting data from 13 sources with 4-layer AI analysis architecture for real-time social pulse tracking.',
    summary: [
      'Public sentiment monitoring',
      '13-source data collection',
      'AI-powered mood index',
    ],
    services: [
      'AI Development',
      'NLP / Sentiment Analysis',
      'Data Pipeline',
      'Full-Stack Development',
    ],
    results:
      'Processes 5,000-20,000 data points daily across Reddit, news, Parliament, RBNZ, and social media with real-time sentiment scoring.',
    featured: true,
    image: '/images/projects/yellowbook.png',
  },
  {
    client: 'Car Scout',
    description:
      'Japanese import used car trading and valuation platform with a 3-layer hybrid pricing model (rule-based, KNN correction, confidence scoring) and multi-platform data scraping.',
    summary: [
      'Car valuation engine',
      'Multi-platform data scraping',
      'Trading & pricing platform',
    ],
    services: [
      'AI Development',
      'Web Scraping',
      'Full-Stack Development',
      'Data Infrastructure',
    ],
    results:
      'Deployed hybrid pricing model covering 3 vehicle models with real-time TradeMe market data integration and automated cost calculation.',
    featured: true,
    image: '/images/projects/carscout.jpg',
  },
  {
    client: 'Warm Voyage',
    description:
      'Premium Auckland Chinese tourism and chauffeur service website with bilingual support, SEO architecture, and conversion-optimized booking flow.',
    summary: [
      'Premium travel website',
      'SEO architecture',
      'Conversion optimization',
    ],
    services: [
      'Website Development',
      'SEO Optimization',
      'Conversion Optimization',
    ],
    results:
      'Increased booking conversions by 30% and organic traffic by 50%.',
    featured: true,
    image: '/images/projects/warmvoyage.jpg',
  },
  {
    client: 'China Travel Service NZ',
    description:
      'Tour company website with SEO infrastructure and automated lead capture system for NZ tourism market.',
    summary: [
      'Tour company website',
      'SEO infrastructure',
      'Lead capture system',
    ],
    services: ['Website Development', 'SEO Optimization', 'Lead Capture'],
    results:
      'Increased organic traffic by 40% and lead conversion by 25%.',
    featured: true,
  },
  {
    client: 'BizMate',
    description:
      'AI-powered business assistant SaaS for NZ Chinese entrepreneurs — virtual COO with compliance calendar, tax calculators, GP finder, and Xero integration.',
    summary: [
      'AI business assistant SaaS',
      'Compliance & tax automation',
      'Multi-platform integration',
    ],
    services: [
      'AI Development',
      'SaaS Platform',
      'Payment Integration',
      'Full-Stack Development',
    ],
    results:
      'Phase 1 MVP targeting core features: AI chat, business calculators, compliance calendar, and Stripe payment integration.',
    featured: false,
  },
  {
    client: 'Movehub',
    description:
      'Cross-border workforce management platform connecting talent with businesses across NZ and Asia-Pacific, powering work visa services via workvisas.work.',
    summary: [
      'Cross-border workforce platform',
      'Work visa services',
      'Talent management',
    ],
    services: [
      'Website Development',
      'Brand & Content',
      'Business Systems',
    ],
    results:
      'Successfully facilitating cross-border talent placement for partner businesses including Warm Voyage driver recruitment.',
    featured: false,
  },
];

export const featuredProjects = projects.filter((p) => p.featured);
