interface ServiceCardProps {
  icon: string;
  title: string;
  description: string[];
  accent: string;
}

const ServiceCard = ({ icon, title, description, accent }: ServiceCardProps) => {
  return (
    <div className="service-card bg-gray-800/80 p-8 rounded-xl">
      <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${accent} flex items-center justify-center text-2xl mb-5`}>
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-white mb-4">{title}</h3>
      <ul className="space-y-2.5">
        {description.map((item, index) => (
          <li key={index} className="text-gray-400 flex items-start gap-2.5">
            <span className="text-blue-400 mt-1.5 text-xs">&#9679;</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ServiceCard;
