interface BlogCardProps {
  title: string;
  tag?: string;
}

const BlogCard = ({ title, tag = 'Insight' }: BlogCardProps) => {
  return (
    <div className="blog-card bg-gray-800/80 p-7 rounded-xl flex flex-col">
      <span className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-3">
        {tag}
      </span>
      <h3 className="text-lg font-semibold text-white mb-3 flex-1">{title}</h3>
      <span className="text-sm text-gray-500 flex items-center gap-1.5">
        Read more &rarr;
      </span>
    </div>
  );
};

export default BlogCard;
