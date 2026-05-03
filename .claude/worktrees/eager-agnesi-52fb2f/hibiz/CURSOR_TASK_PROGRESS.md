# Cursor 任务：增强进度看板 + 版本路线图 + 文件架构图

> 本文件为 Cursor AI 编程助手的实施指南。三个 Tab 页面，共享 `/progress` 路由。

## 总览

将现有 `/progress` 页面升级为三 Tab 看板：

| Tab | 路由 | 功能 |
|-----|------|------|
| 任务进度 | `/progress` | 当前版本详细任务看板（已有，增强） |
| 版本路线图 | `/progress/roadmap` | 全版本时间线，可展开 |
| 文件架构 | `/progress/architecture` | 分层文件结构 + 依赖关系 |

## 现有文件

- 页面：`src/app/progress/page.tsx`（当前进度看板）
- 数据：`src/data/dev-progress.ts`（任务 + 路线图数据，已更新）

## 数据源

`dev-progress.ts` 已包含两套数据：

1. **`DEV_PROGRESS_PHASES`** — 当前版本的任务列表（已有）
2. **`ROADMAP_VERSIONS`** — 版本路线图时间线（新增，类型 `RoadmapVersion[]`）

不需要新建数据文件。

---

## Tab 1：任务进度（增强现有页面）

路由：`/progress`

### 改动

1. **添加 Tab 导航栏**（顶部 header 下方）：
   ```
   [任务进度]  [版本路线图]  [文件架构]
   ```
   当前 Tab 高亮（border-bottom emerald）。用 `<Link>` 导航。

2. **添加筛选器**（任务列表上方）：
   - 状态筛选：全部 / 已完成 / 进行中 / 待办 / 阻塞
   - 用 `searchParams.filter` 控制，无需客户端状态

3. **保留现有所有功能**：
   - 整体完成度百分比
   - 分阶段卡片
   - 进度条
   - 状态标签
   - 条目备注

### 不改动

- 不改数据结构
- 不改配色风格（保持深绿 header + 米白背景）

---

## Tab 2：版本路线图

路由：`/progress/roadmap`

### 创建 `src/app/progress/roadmap/page.tsx`

### 设计

垂直时间线布局（手机友好）：

```
  ●── v0.1 — 底座与主链路 ──── 2026-04-04 ── ✅ 已发布
  │   • Supabase Auth + RLS
  │   • Rule-based 意图编译器
  │   • ...（可展开/折叠）
  │
  ●── v0.2 — 模板预设 + 商家信息 ── 2026-04-05 ── ✅ 已发布
  │   • 6 个行业场景预设
  │   • ...
  │
  ●── v0.2.1 — URL 提取管线 ── 2026-04-07 ── ✅ 已发布
  │   • 三层提取管线
  │   • ...
  │
  ◉── v0.2.2 — 骨架模板系统 ── 开发中 ── 🔨 当前
  │   • 预制骨架 + AI 填肉
  │   • ...
  │
  ○── v0.3 — 社媒营销 ── 规划中 ── 📋 下一步
  │   • 社媒文案生成
  │   • ...
  │
  ○── v1.0 — 公开发布 ── 规划中
```

### 样式规则

| 状态 | 节点样式 | 卡片样式 |
|------|---------|---------|
| `released` | 实心绿点 `bg-emerald-600` | 默认白卡，左边框绿 |
| `current` | 实心大圆点 + 脉冲动画 `bg-amber-500 animate-pulse` | 高亮卡片，黄色左边框 |
| `next` | 空心圆点 `border-stone-400` | 淡灰卡片 |
| `planned` | 空心小圆点 `border-stone-300` | 更淡灰卡片 |

### 展开/折叠

- **`released` 版本**：默认折叠（只显示版本号 + 标题 + 日期 + 状态），点击展开 highlights
- **`current` 版本**：默认展开
- **`next` 和 `planned`**：默认展开（内容少）

使用 HTML `<details>` + `<summary>` 实现（零 JS，SSR 友好）。

### 数据读取

```typescript
import { ROADMAP_VERSIONS } from "@/data/dev-progress";
```

直接遍历 `ROADMAP_VERSIONS` 数组渲染。

---

## Tab 3：文件架构图

路由：`/progress/architecture`

### 创建 `src/app/progress/architecture/page.tsx`

### 设计：分层架构图 + 文件清单

不做完整依赖图（太复杂、手机上不可读）。做分层可展开结构：

```
┌─────────────────────────────────────────┐
│  Pages (src/app/)                       │
│  ├── /app/projects/    → 商家工作台      │
│  ├── /site/[slug]/     → 公开微站        │
│  ├── /forms/[slug]/    → 独立表单        │
│  ├── /progress/        → 开发看板        │
│  └── /login/, /auth/   → 认证           │
├─────────────────────────────────────────┤
│  Components (src/components/)           │
│  ├── Hero, Navbar, Footer              │
│  ├── skeleton-picker (v0.2.2)          │
│  └── ...                                │
├─────────────────────────────────────────┤
│  Lib (src/lib/)                         │
│  ├── compiler/    → 意图编译器          │
│  ├── extraction/  → URL 提取管线        │
│  ├── generation/  → 文案生成 + 装配      │
│  └── supabase/    → 数据库客户端         │
├─────────────────────────────────────────┤
│  Types (src/types/)                     │
│  ├── compiled-intent.ts                 │
│  ├── render-model.ts                    │
│  ├── merchant-profile.ts               │
│  └── skeleton.ts (v0.2.2)              │
├─────────────────────────────────────────┤
│  Data (src/data/)                       │
│  ├── template-presets.ts               │
│  ├── dev-progress.ts                   │
│  ├── poster-templates.ts              │
│  └── skeletons/ (v0.2.2)              │
└─────────────────────────────────────────┘
```

### 实现方式

**数据源**：静态定义在 `src/data/architecture-map.ts`（新文件）。

```typescript
export interface ArchLayer {
  id: string;
  name: string;
  nameEn: string;
  color: string;          // Tailwind color class
  icon: string;           // emoji
  basePath: string;       // "src/app/"
  groups: ArchGroup[];
}

export interface ArchGroup {
  name: string;
  description: string;
  files: ArchFile[];
}

export interface ArchFile {
  path: string;            // 相对路径 "compiler/rule-based.ts"
  description: string;     // "规则编译器"
  imports: string[];       // 导入的其他文件路径（简化版）
  importedBy: string[];    // 被谁导入
  isNew?: boolean;         // v0.2.2 新增标记
}

export const ARCHITECTURE_LAYERS: ArchLayer[] = [
  {
    id: "pages",
    name: "页面",
    nameEn: "Pages",
    color: "blue",
    icon: "📄",
    basePath: "src/app/",
    groups: [
      {
        name: "商家工作台",
        description: "项目管理、创建、编辑",
        files: [
          {
            path: "app/projects/new/page.tsx",
            description: "新建项目（分步创建流程）",
            imports: ["data/skeletons/index.ts", "data/template-presets.ts"],
            importedBy: [],
          },
          // ... more files
        ],
      },
      // ... more groups
    ],
  },
  {
    id: "lib",
    name: "业务逻辑",
    nameEn: "Lib",
    color: "orange",
    icon: "⚙️",
    basePath: "src/lib/",
    groups: [
      {
        name: "URL 提取管线",
        description: "三层 fallback: API → __NEXT_DATA__ → Jina + OpenAI",
        files: [
          {
            path: "extraction/extraction-layers.ts",
            description: "多层编排入口",
            imports: ["extraction/trademe-api.ts", "extraction/extract-next-data.ts", "extraction/extract-listing.ts"],
            importedBy: ["app/projects/merchant-profile-actions.ts"],
          },
          // ...
        ],
      },
      {
        name: "生成管线",
        description: "文案生成 + 模型装配",
        files: [
          {
            path: "generation/assemble.ts",
            description: "RenderModel 装配器",
            imports: ["types/compiled-intent.ts", "types/render-model.ts"],
            importedBy: ["app/projects/generation-actions.ts"],
          },
          // ...
        ],
      },
      // ...
    ],
  },
  // ... types, data, components layers
];
```

### 渲染

每个 Layer 是一个可折叠卡片：
- 卡片头部：图标 + 层名称 + 文件数量
- 展开后：按 group 分组，每组有标题和描述
- 每个文件一行：路径 + 描述
- 点击文件 → 展开依赖信息（导入了谁、被谁导入）

### 依赖箭头

不用 SVG/Canvas 画线。用文字表示：

```
extraction-layers.ts
  ├── 导入 → trademe-api.ts
  ├── 导入 → extract-next-data.ts
  └── 导入 → extract-listing.ts

  被引用 ← merchant-profile-actions.ts
```

### 新文件标记

`isNew: true` 的文件显示小标签 `NEW`（绿色 badge），表示 v0.2.2 新增。

### 样式

与 `/progress` 主页保持一致：
- 深绿 header（复用）
- 米白背景
- 白色卡片 + 圆角 + 阴影

---

## 共享布局

### 创建 `src/app/progress/layout.tsx`

提取共享的 header + Tab 导航：

```tsx
import Link from "next/link";

interface ProgressLayoutProps {
  children: React.ReactNode;
}

export default function ProgressLayout({ children }: ProgressLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f4f0ea] text-stone-900">
      {/* Header（从现有 page.tsx 提取） */}
      <div
        className="border-b border-stone-200/80 px-4 py-14 text-white"
        style={{ backgroundImage: "linear-gradient(135deg, #1c1917 0%, #14532d 48%, #0f172a 100%)" }}
      >
        <div className="mx-auto max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-300/90">HiBiz · internal</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">项目看板</h1>
        </div>
      </div>

      {/* Tab 导航 */}
      <nav className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl gap-0 px-4">
          <TabLink href="/progress" label="任务进度" />
          <TabLink href="/progress/roadmap" label="版本路线图" />
          <TabLink href="/progress/architecture" label="文件架构" />
        </div>
      </nav>

      {children}
    </div>
  );
}
```

**Tab 高亮逻辑**：用 `usePathname()`（需要 `"use client"` wrapper）或通过 `searchParams` 判断。

由于 layout 是 Server Component，建议把 Tab 导航提取为单独的 Client Component `<ProgressTabs />`，用 `usePathname()` 判断当前激活 Tab。

---

## 新建文件清单

| 文件 | 用途 |
|------|------|
| `src/app/progress/layout.tsx` | 共享 header + Tab 导航 |
| `src/app/progress/roadmap/page.tsx` | 版本路线图时间线 |
| `src/app/progress/architecture/page.tsx` | 文件架构分层图 |
| `src/data/architecture-map.ts` | 架构数据（层、组、文件、依赖） |
| `src/components/progress-tabs.tsx` | Tab 导航客户端组件 |

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/app/progress/page.tsx` | 移除 header（提到 layout），添加筛选器 |
| `src/data/dev-progress.ts` | 已更新，无需改动 |

---

## 验证清单

- [ ] `/progress` — 任务看板正常显示，Tab 导航可用
- [ ] `/progress/roadmap` — 时间线渲染所有版本，current 版本展开且有脉冲动画
- [ ] `/progress/architecture` — 5 层架构图可展开，文件依赖可查看
- [ ] 手机端（375px 宽）三个页面都可正常浏览
- [ ] Tab 切换不刷新 header
- [ ] `tsc --noEmit` 无类型错误

## 注意事项

1. **全部 Server Component**（除了 `<ProgressTabs />`）
2. **不引入任何图表库**（d3、recharts 等）——纯 HTML/CSS
3. **architecture-map.ts 数据手动维护**——不需要运行时分析 import
4. **保持现有 progress 页面的设计风格**
5. **文件 < 400 行**，超出就拆分
