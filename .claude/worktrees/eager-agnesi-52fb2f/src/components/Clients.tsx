import { projects } from '../data/projects';

const Clients = () => {
  return (
    <section className="py-14 bg-gray-900/50 border-y border-gray-800/50">
      <div className="container mx-auto px-4">
        <p className="text-center text-gray-500 text-sm font-medium uppercase tracking-wider mb-8">
          Trusted by growing businesses in New Zealand and Asia-Pacific
        </p>
        <div className="flex flex-wrap justify-center items-center gap-4 md:gap-6">
          {projects.map((project, index) => (
            <div
              key={index}
              className="client-card px-6 py-3 rounded-lg"
            >
              <p className="text-gray-300 font-medium text-sm whitespace-nowrap">
                {project.client}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Clients;
