import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'New Zealand Immigration Assessment | Magic Lab',
  description: 'Free online assessment tool for New Zealand immigration pathways including Skilled Migrant, Green List, and Student Pathway.',
};

interface ImmigrationPathway {
  id: string;
  title: string;
  description: string;
  icon: string;
}

const immigrationPathways: ImmigrationPathway[] = [
  {
    id: 'smc',
    title: 'Skilled Migrant (SMC)',
    description: '6-point system based on qualifications, registration or income',
    icon: '📋'
  },
  {
    id: 'greenlist',
    title: 'Green List Residence',
    description: 'Tier 1 straight to residence / Tier 2 work to residence',
    icon: '🟢'
  },
  {
    id: 'student',
    title: 'Student Pathway',
    description: 'Study to work to residence',
    icon: '🎓'
  },
  {
    id: 'partner',
    title: 'Partner Visa',
    description: 'Partner of NZ citizen or resident',
    icon: '💑'
  },
  {
    id: 'parent',
    title: 'Parent Category',
    description: 'EOI ballot system, sponsor income requirements',
    icon: '👨‍👩‍👧‍👦'
  },
  {
    id: 'investor',
    title: 'Active Investor Plus',
    description: 'Growth ($5M) or Balanced ($10M)',
    icon: '💼'
  }
];

const ImmigrationAssessmentPage = () => {
  return (
    <div className="py-32 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            New Zealand Immigration Assessment
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Based on INZ policies effective as of April 2026. Median wage: NZD $35.00/hr.
          </p>
        </div>

        <div className="bg-gray-800 p-8 rounded-xl mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Select your immigration pathway
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {immigrationPathways.map((pathway) => (
              <div 
                key={pathway.id}
                className="bg-gray-700 p-6 rounded-lg cursor-pointer hover:bg-gray-600 transition-colors"
              >
                <div className="text-4xl mb-4">{pathway.icon}</div>
                <h3 className="text-xl font-semibold text-white mb-2">{pathway.title}</h3>
                <p className="text-gray-300">{pathway.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 p-8 rounded-xl">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Green List Occupations
          </h2>
          <div className="mb-6">
            <input 
              type="text" 
              placeholder="Search for occupation..." 
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-white mb-2">Tier 1 (Straight to Residence)</h3>
              <ul className="space-y-2 text-gray-300">
                <li>General Medical Practitioners</li>
                <li>Psychiatrists</li>
                <li>Surgeons</li>
                <li>Anesthetists</li>
                <li>Cardiologists</li>
              </ul>
            </div>
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-white mb-2">Tier 2 (Work to Residence)</h3>
              <ul className="space-y-2 text-gray-300">
                <li>Software Engineers</li>
                <li>ICT Project Managers</li>
                <li>Electrical Engineers</li>
                <li>Mechanical Engineers</li>
                <li>Registered Nurses</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 p-8 rounded-xl mt-12">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Skilled Migrant (6-point system)
          </h2>
          <div className="space-y-6">
            <div>
              <label className="block text-white font-medium mb-2">Qualifications</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select qualification level</option>
                <option value="level-8">Bachelor's degree (Level 8) - 5 points</option>
                <option value="level-9">Master's degree (Level 9) - 5 points</option>
                <option value="level-10">Doctoral degree (Level 10) - 5 points</option>
                <option value="level-7">Graduate diploma (Level 7) - 4 points</option>
                <option value="level-6">Diploma (Level 6) - 3 points</option>
              </select>
            </div>
            <div>
              <label className="block text-white font-medium mb-2">Work Experience</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select years of experience</option>
                <option value="2-5">2-5 years - 1 point</option>
                <option value="6-10">6-10 years - 2 points</option>
                <option value="11+">11+ years - 3 points</option>
              </select>
            </div>
            <div>
              <label className="block text-white font-medium mb-2">Age</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select age range</option>
                <option value="18-24">18-24 - 2 points</option>
                <option value="25-39">25-39 - 3 points</option>
                <option value="40-44">40-44 - 2 points</option>
                <option value="45-49">45-49 - 1 point</option>
              </select>
            </div>
            <div>
              <label className="block text-white font-medium mb-2">Job Offer</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select job offer type</option>
                <option value="skilled">Skilled job offer - 2 points</option>
                <option value="greenlist">Green List job offer - 2 points</option>
                <option value="none">No job offer - 0 points</option>
              </select>
            </div>
            <div>
              <label className="block text-white font-medium mb-2">English Language</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select English level</option>
                <option value="clb-9+">CLB 9+ (IELTS 7.0) - 2 points</option>
                <option value="clb-7-8">CLB 7-8 (IELTS 6.0-6.5) - 1 point</option>
                <option value="clb-5-6">CLB 5-6 (IELTS 5.0-5.5) - 0 points</option>
              </select>
            </div>
            <div>
              <label className="block text-white font-medium mb-2">Nz Study</label>
              <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Select NZ study status</option>
                <option value="level-8+">Level 8+ qualification in NZ - 1 point</option>
                <option value="level-4-7">Level 4-7 qualification in NZ - 0 points</option>
                <option value="none">No NZ study - 0 points</option>
              </select>
            </div>
            <button className="btn-primary w-full px-8 py-3 rounded-lg font-semibold text-white">
              Calculate Score
            </button>
          </div>
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-400">
            This tool provides general information only and does not constitute legal advice. 
            Immigration policies change frequently. For a personalised assessment tailored to your circumstances,
            please consult a licensed immigration advisor.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ImmigrationAssessmentPage;