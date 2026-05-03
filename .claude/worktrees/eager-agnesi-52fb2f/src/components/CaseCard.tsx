/* eslint-disable @next/next/no-img-element */

interface CaseCardProps {
  client: string;
  description: string[];
  image?: string;
}

const tagColors: Record<string, string> = {
  'AI': 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Web': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Data': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'SEO': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
};

function getTag(desc: string): { label: string; color: string } {
  if (desc.toLowerCase().includes('ai') || desc.toLowerCase().includes('quantitative') || desc.toLowerCase().includes('sentiment'))
    return { label: 'AI', color: tagColors['AI'] };
  if (desc.toLowerCase().includes('data') || desc.toLowerCase().includes('scraping'))
    return { label: 'Data', color: tagColors['Data'] };
  if (desc.toLowerCase().includes('seo') || desc.toLowerCase().includes('conversion'))
    return { label: 'SEO', color: tagColors['SEO'] };
  return { label: 'Web', color: tagColors['Web'] };
}

const CaseCard = ({ client, description, image }: CaseCardProps) => {
  const tag = getTag(description.join(' '));

  return (
    <div className="case-card bg-gray-800/80 rounded-xl flex flex-col h-full overflow-hidden">
      {image ? (
        <div className="relative w-full h-44 overflow-hidden bg-gray-700">
          <img
            src={image}
            alt={`${client} project screenshot`}
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-800/60 to-transparent" />
        </div>
      ) : (
        <div className="w-full h-44 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
          <span className="text-4xl text-gray-500">{client.charAt(0)}</span>
        </div>
      )}
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{client}</h3>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tag.color}`}>
            {tag.label}
          </span>
        </div>
        <ul className="space-y-2 flex-1">
          {description.map((item, index) => (
            <li key={index} className="text-gray-400 flex items-start gap-2.5 text-sm">
              <span className="text-blue-400 mt-1 text-xs">&#9679;</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default CaseCard;
