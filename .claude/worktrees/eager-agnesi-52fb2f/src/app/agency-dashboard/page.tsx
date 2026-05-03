import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agency Dashboard | Magic Lab',
  description: 'Dashboard for New Zealand immigration agencies to manage assessment tools and generate marketing content.',
};

const AgencyDashboardPage = () => {
  return (
    <div className="py-32 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Agency Dashboard
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Manage your immigration assessment tools and generate marketing content
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="bg-gray-800 p-8 rounded-xl">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Generate QR Code
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-white font-medium mb-2">Agency Name</label>
                <input 
                  type="text" 
                  placeholder="Enter your agency name" 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">Redirect URL</label>
                <input 
                  type="url" 
                  placeholder="https://your-agency.com" 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">Assessment Type</label>
                <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">Select assessment type</option>
                  <option value="smc">Skilled Migrant (SMC)</option>
                  <option value="greenlist">Green List</option>
                  <option value="student">Student Pathway</option>
                  <option value="all">All Assessments</option>
                </select>
              </div>
              <button className="btn-primary w-full px-8 py-3 rounded-lg font-semibold text-white">
                Generate QR Code
              </button>
              <div className="bg-white p-4 rounded-lg text-center">
                <p className="text-gray-800 mb-2">QR Code Preview</p>
                <div className="w-48 h-48 bg-gray-200 mx-auto flex items-center justify-center">
                  <p className="text-gray-500">QR Code</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 p-8 rounded-xl">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Marketing Content Generator
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-white font-medium mb-2">Content Type</label>
                <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">Select content type</option>
                  <option value="social">Social Media Post</option>
                  <option value="website">Website Copy</option>
                  <option value="email">Email Campaign</option>
                </select>
              </div>
              <div>
                <label className="block text-white font-medium mb-2">Platform</label>
                <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">Select platform</option>
                  <option value="wechat">WeChat</option>
                  <option value="douyin">Douyin</option>
                  <option value="xiaohongshu">Xiaohongshu</option>
                  <option value="website">Website</option>
                </select>
              </div>
              <div>
                <label className="block text-white font-medium mb-2">Key Message</label>
                <textarea 
                  placeholder="Enter your key message" 
                  rows={4} 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                ></textarea>
              </div>
              <button className="btn-primary w-full px-8 py-3 rounded-lg font-semibold text-white">
                Generate Content
              </button>
              <div className="bg-gray-700 p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">Generated Content</h3>
                <p className="text-gray-300">
                  [Generated content will appear here]
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 p-8 rounded-xl">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Usage Statistics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-gray-700 p-6 rounded-lg text-center">
              <h3 className="text-gray-400 mb-2">Total Assessments</h3>
              <p className="text-3xl font-bold text-white">128</p>
            </div>
            <div className="bg-gray-700 p-6 rounded-lg text-center">
              <h3 className="text-gray-400 mb-2">Valid Forms</h3>
              <p className="text-3xl font-bold text-white">86</p>
            </div>
            <div className="bg-gray-700 p-6 rounded-lg text-center">
              <h3 className="text-gray-400 mb-2">Monthly Cost</h3>
              <p className="text-3xl font-bold text-white">$860</p>
            </div>
          </div>
          <div className="bg-gray-700 p-6 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-white">Assessment completed</p>
                  <p className="text-gray-400 text-sm">Skilled Migrant (SMC)</p>
                </div>
                <p className="text-gray-300">2 hours ago</p>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-white">QR code generated</p>
                  <p className="text-gray-400 text-sm">Agency: NZ Immigration Services</p>
                </div>
                <p className="text-gray-300">5 hours ago</p>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-white">Content generated</p>
                  <p className="text-gray-400 text-sm">Social media post for Douyin</p>
                </div>
                <p className="text-gray-300">1 day ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyDashboardPage;