# Cursor 任务：创建工具箱页面与导航集成

## 目标

创建一个独立的工具箱页面 `/toolkit`，将所有工具（海报、素材、社媒、表单、数据）集中在一处。

### 核心需求

1. **一站式工具访问**：不再散落于仪表板各处
2. **信息自动填充**：个人信息（电话、邮箱、名字）配置一次，所有工具自动获取 — **无需重复输入**
3. **移动友好**：后台在手机上非常难用，新工具箱必须 mobile-first
4. **导航整理**：更新左侧边栏和顶部导航，突出工具箱

## 创建任务

### 步骤 1：了解现有结构

打开以下文件，理解现有模式：

1. `src/app/app/projects/[id]/layout.tsx` — 项目布局（左侧边栏 + 顶部导航 + 主内容）
2. `src/app/app/projects/[id]/page.tsx` — 项目主页（如何获取 merchant_profile）
3. `src/types/merchant-profile.ts` — MerchantProfile 类型定义（获取联系信息）
4. `src/components/project-sub-nav.tsx` — 顶部导航菜单
5. `src/components/project-workflow-sidebar.tsx` — 左侧边栏快速链接
6. `src/app/app/projects/[id]/poster/page.tsx` — 海报页面（参考结构）

### 步骤 2：创建工具箱页面

**文件路径**：`src/app/app/projects/[id]/toolkit/page.tsx`

#### 2.1 页面结构

```typescript
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
  // 1. 验证项目和用户
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  // 2. 获取 merchant_profile
  const { data: microsite } = await supabase
    .from("microsites")
    .select("merchant_profile")
    .eq("project_id", params.id)
    .maybeSingle();

  const mp = microsite ? parseMerchantProfile(microsite.merchant_profile) : null;
  const contact = mp?.contact || {};
  const name = mp?.name || contact.name || "商家";
  const phone = contact.phone || "";
  const email = contact.email || "";
  const logoUrl = mp?.logo_url || null;

  // 3. 工具列表定义
  const tools = [
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
      {/* 返回链接 */}
      <Link href={`/app/projects/${params.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>

      {/* 页面标题 */}
      <div className="mt-6 mb-8">
        <h1 className="font-display text-2xl font-bold text-stone-900">🧰 工具箱</h1>
        <p className="mt-1 text-sm text-stone-600">
          所有工具集合，个人信息自动同步，无需重复输入
        </p>
      </div>

      {/* 个人信息摘要卡片 */}
      <div className="mb-8 rounded-lg border border-stone-200 bg-gradient-to-r from-emerald-50 to-stone-50 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={name}
                className="h-12 w-12 rounded-lg object-cover"
              />
            )}
            <div>
              <p className="text-sm font-semibold text-stone-900">{name}</p>
              {phone && <p className="text-xs text-stone-600">📱 {phone}</p>}
              {email && <p className="text-xs text-stone-600">✉️ {email}</p>}
            </div>
          </div>
          <Link
            href={`/app/projects/${params.id}`}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            编辑 →
          </Link>
        </div>
      </div>

      {/* 工具卡片网格 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.id}
            href={tool.href}
            className="group rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md hover:bg-emerald-50"
          >
            <div className="mb-3 text-3xl">{tool.icon}</div>
            <h3 className="font-semibold text-stone-900 group-hover:text-emerald-900">
              {tool.title}
            </h3>
            <p className="mt-1 text-sm text-stone-600 group-hover:text-stone-700">
              {tool.description}
            </p>
            <div className="mt-4 inline-block text-xs font-medium text-emerald-700 group-hover:text-emerald-900">
              打开 →
            </div>
          </Link>
        ))}
      </div>

      {/* 提示 */}
      <div className="mt-8 rounded-lg bg-blue-50 p-4 border border-blue-200">
        <p className="text-xs font-medium text-blue-900">
          💡 提示：所有工具中的联系方式会自动从您的商家信息中获取，
          如需更改，请回到项目主页编辑个人信息。
        </p>
      </div>
    </div>
  );
}
```

#### 2.2 关键点

- **Server Component**：直接在服务端获取 merchant_profile，确保信息始终最新
- **自动填充**：所有工具通过链接跳转，无需传递数据（各工具自己从 DB 读取）
- **Mobile First**：Grid 在 mobile 为 1 列，md 为 2 列，lg 为 3 列
- **信息卡**：顶部展示当前配置的信息，并链接回项目页面编辑

### 步骤 3：更新顶部导航

**文件**：`src/components/project-sub-nav.tsx`

修改 `items` 数组，用 "工具箱" 替代分散的工具链接：

**修改前**：
```typescript
const items: { href: string; label: string }[] = [
  { href: base, label: "项目" },
  { href: `${base}/media`, label: "素材" },
  { href: `${base}/social`, label: "社媒" },
  { href: `${base}/social/history`, label: "社媒历史" },
  { href: `${base}/dashboard`, label: "数据" },
  { href: `${base}/leads`, label: "线索" },
];
```

**修改后**：
```typescript
const items: { href: string; label: string }[] = [
  { href: base, label: "项目" },
  { href: `${base}/toolkit`, label: "工具箱" },
  { href: `${base}/dashboard`, label: "数据" },
  { href: `${base}/leads`, label: "线索" },
];
```

更新 `isActive()` 函数，确保 toolkit 路由正确激活：
```typescript
function isActive(href: string): boolean {
  if (href === base) {
    return pathname === base;
  }
  if (href === `${base}/toolkit`) {
    return pathname === `${base}/toolkit` || pathname.startsWith(`${base}/toolkit/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

### 步骤 4：更新左侧边栏

**文件**：`src/components/project-workflow-sidebar.tsx`

修改 `SECONDARY_LINKS` 数组，用单个工具箱链接替代分散的链接：

**修改前**：
```typescript
const SECONDARY_LINKS: { label: string; path: string }[] = [
  { label: "🖼️ 素材库", path: "/media" },
  { label: "📊 数据报表", path: "/dashboard" },
  { label: "🎬 社交媒体", path: "/social" },
];
```

**修改后**：
```typescript
const SECONDARY_LINKS: { label: string; path: string }[] = [
  { label: "🧰 工具箱", path: "/toolkit" },
];
```

### 步骤 5：验证和测试

1. **构建验证**：
   ```bash
   npm run build
   ```
   确保无 TypeScript 错误

2. **本地测试**：
   ```bash
   npm run dev
   ```
   - 导航到项目详情页
   - 点击顶部 "工具箱" 或左侧 "🧰 工具箱"
   - 验证页面加载，个人信息正确显示
   - 点击各工具卡片，确保链接工作

3. **Mobile 测试**：
   - 用浏览器开发者工具模拟手机（375px 宽度）
   - 确保卡片响应式（1 列）
   - 个人信息卡片在小屏幕上是否易读

## 常见问题排查

| 问题 | 解决 |
|------|------|
| 404 Not Found | 确保 toolkit 文件夹名称正确，路由 `/[id]/toolkit/page.tsx` |
| 个人信息不显示 | 检查 parseMerchantProfile 是否正确解析，数据库中是否有数据 |
| 导航未激活 | 检查 isActive() 逻辑，确保路由匹配 |
| 样式不匹配 | 参考 `poster/page.tsx` 或 `media/page.tsx` 的 Tailwind 类名 |

## 完成标志

✓ 文件 `src/app/app/projects/[id]/toolkit/page.tsx` 创建完成
✓ `src/components/project-sub-nav.tsx` 更新完成
✓ `src/components/project-workflow-sidebar.tsx` 更新完成
✓ `npm run build` 无错误
✓ 本地测试通过（导航、页面加载、信息显示、响应式）

---

**提交**：完成后回复 "✅ 工具箱页面创建完成" + 任何问题或建议。
