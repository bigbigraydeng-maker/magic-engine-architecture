import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseMerchantProfile } from "@/types/merchant-profile";

export const dynamic = "force-dynamic";

interface ToolkitPageProps {
  params: { id: string };
}

export const metadata = {
  title: "工具箱 — HiBiz",
};

export default async function ToolkitPage({ params }: ToolkitPageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const { data: microsite } = await supabase
    .from("microsites")
    .select("merchant_profile")
    .eq("project_id", params.id)
    .maybeSingle();

  const mp = microsite ? parseMerchantProfile(microsite.merchant_profile) : null;
  const contact = mp?.contact ?? {};
  const name = mp?.display_name ?? mp?.company_name ?? "商家";
  const phone = contact.phone ?? "";
  const email = contact.email ?? "";
  const logoUrl = mp?.logo_url ?? null;

  const tools = [
    {
      id: "trademe-poster",
      title: "TradeMe → 海报",
      description: "粘贴房源链接，自动抓取要点并写入海报素材",
      icon: "🔗",
      href: `/app/projects/${params.id}/trademe-poster`,
    },
    {
      id: "poster",
      title: "海报设计",
      description: "创建专业房产宣传海报，一键生成多种模板",
      icon: "🖼️",
      href: `/app/projects/${params.id}/poster`,
    },
    {
      id: "media",
      title: "素材库",
      description: "搜索 Unsplash 高质量图片，管理项目所有素材",
      icon: "🖥️",
      href: `/app/projects/${params.id}/media`,
    },
    {
      id: "social",
      title: "社交媒体",
      description: "一键生成社媒文案、海报和分享包",
      icon: "📱",
      href: `/app/projects/${params.id}/social`,
    },
    {
      id: "leads",
      title: "表单与线索",
      description: "查看表单提交和客户线索数据",
      icon: "📋",
      href: `/app/projects/${params.id}/leads`,
    },
    {
      id: "dashboard",
      title: "数据报表",
      description: "访问量、来源、转化数据一览无遗",
      icon: "📊",
      href: `/app/projects/${params.id}/dashboard`,
    },
  ];

  return (
    <div>
      <Link href={`/app/projects/${params.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="font-display text-2xl font-bold text-stone-900">🧰 工具箱</h1>
        <p className="mt-1 text-sm text-stone-600">所有工具集合，个人信息自动同步，无需重复输入</p>
      </div>

      <div className="mb-8 rounded-lg border border-stone-200 bg-gradient-to-r from-emerald-50 to-stone-50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900 truncate">{name}</p>
              {phone ? <p className="text-xs text-stone-600">📱 {phone}</p> : null}
              {email ? <p className="text-xs text-stone-600 break-all">✉️ {email}</p> : null}
            </div>
          </div>
          <Link
            href={`/app/projects/${params.id}#workflow-merchant`}
            className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            编辑商家信息 →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.id}
            href={tool.href}
            className="group rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md hover:bg-emerald-50"
          >
            <div className="mb-3 text-3xl">{tool.icon}</div>
            <h2 className="font-semibold text-stone-900 group-hover:text-emerald-900">{tool.title}</h2>
            <p className="mt-1 text-sm text-stone-600 group-hover:text-stone-700">{tool.description}</p>
            <div className="mt-4 inline-block text-xs font-medium text-emerald-700 group-hover:text-emerald-900">
              打开 →
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-xs font-medium text-blue-900">
          💡 提示：各工具会从商家资料中读取联系方式；修改请回到项目页的「Business details」。
        </p>
      </div>
    </div>
  );
}
