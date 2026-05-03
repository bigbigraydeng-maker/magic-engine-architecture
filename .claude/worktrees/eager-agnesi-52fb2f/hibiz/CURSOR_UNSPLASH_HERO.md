# Cursor 任务：Unsplash 图片直接应用到 Hero / 首页

## 目标

让 Unsplash 搜索和选择的图片能够：
1. **直接应用到网站 Hero 和首页**（不仅仅保存到素材库）
2. **在"素材库"页面中搜索 Unsplash 并选择图片时，立即应用到 hero**
3. **无缝集成**：选完图片后自动更新网站预览

## 现状分析

### 现有 Unsplash 集成

- **搜索**：`src/lib/media/unsplash-client.ts` 提供 `searchUnsplashPhotos()`
- **下载统计**：`triggerUnsplashDownload()` 跟踪使用
- **素材库**：`src/app/app/projects/[id]/media/page.tsx` 页面中可搜索和管理

### 问题

现在 Unsplash 图片只能被添加到"素材库"（media_assets 表），但：
- ❌ 选择图片后，不会自动应用到网站 hero
- ❌ 用户需要手动在另一个地方配置 hero 图片
- ❌ 工作流不连贯

## 实现方案

### 步骤 1：理解现有数据流

打开以下文件：

1. `src/types/merchant-profile.ts` — 查找 hero 相关字段（如 `hero_image_url`）
2. `src/types/skeleton.ts` — 了解 hero 模块配置
3. `src/app/app/projects/[id]/page.tsx` — 查看项目主页如何编辑 hero
4. `src/components/project-compile-v2-card-body.tsx` — 如何展示/编辑 intent

### 步骤 2：在素材库页面添加"应用到 Hero"功能

**文件**：`src/components/MediaLibraryClient.tsx` 或媒体选择相关组件

#### 2.1 方案 A：在素材网格中添加快速操作

在每个素材卡片上添加一个"应用到 Hero"按钮：

```typescript
// 伪代码示例
<button
  onClick={() => applyToHero(asset)}
  className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
>
  ⭐ 应用到 Hero
</button>
```

#### 2.2 实现 applyToHero Server Action

**文件**：`src/app/app/projects/media-actions.ts` 或新建 `media-hero-actions.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function applyImageToHero(projectId: string, imageUrl: string) {
  const supabase = createClient();

  // 1. 验证用户权限
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // 2. 更新 microsites.merchant_profile 的 hero_image_url
  const { data: microsite } = await supabase
    .from("microsites")
    .select("merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!microsite) throw new Error("Microsite not found");

  const mp = parseMerchantProfile(microsite.merchant_profile);
  const updated = {
    ...mp,
    hero_image_url: imageUrl,  // 更新 hero 图片
  };

  const { error } = await supabase
    .from("microsites")
    .update({ merchant_profile: updated })
    .eq("project_id", projectId);

  if (error) throw error;

  // 3. 重新验证缓存
  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath(`/app/projects/${projectId}/media`);
}
```

### 步骤 3：在 Unsplash 搜索结果中也支持"应用到 Hero"

**位置**：Unsplash 搜索组件（可能在 MediaLibraryClient 或单独组件）

当用户搜索 Unsplash 并找到合适的图片时，不是先保存到素材库，而是：
1. 显示预览
2. 添加"应用到 Hero"按钮
3. 点击后直接应用（同时可选择是否保存到素材库）

```typescript
// 伪代码
<UnsplashSearchResult
  photo={photo}
  onApplyToHero={() => applyImageToHero(projectId, photo.urls.regular)}
  onSaveToLibrary={() => saveToMediaLibrary(projectId, photo)}
/>
```

### 步骤 4：在项目主页（意图编译）页面中显示当前 Hero 图片

**文件**：`src/components/project-compile-v2-card-body.tsx`

在 hero 编辑界面中：
1. 显示当前 hero_image_url
2. 添加"更换图片"链接，指向 `/media`
3. 或内嵌一个小的 Unsplash 搜索窗口

```typescript
// 在编译卡片 hero 部分
<div className="mt-4">
  <label className="text-sm font-medium text-stone-900">Hero 背景图</label>
  {heroImageUrl && (
    <img src={heroImageUrl} alt="hero" className="mt-2 h-32 w-full rounded-lg object-cover" />
  )}
  <Link href={`/app/projects/${projectId}/media`} className="mt-2 text-xs text-emerald-700">
    🖼️ 从素材库选择或搜索 Unsplash →
  </Link>
</div>
```

### 步骤 5：网站预览实时更新

**原理**：当 hero_image_url 在 merchant_profile 中更新后，网站预览会自动使用新图片。

确保预览组件读取 merchant_profile 的 hero_image_url：

**文件**：`src/components/RenderMicrosite.tsx` 或 hero 渲染模块

```typescript
// hero 模块渲染时
const heroImageUrl = merchantProfile?.hero_image_url || defaultImage;
<Hero imageUrl={heroImageUrl} />
```

## 工作流总结

```
用户在 /media 页面
  → 搜索 Unsplash 或选择现有素材
  → 点击"⭐ 应用到 Hero"
  → Server Action 更新 merchant_profile.hero_image_url
  → 缓存重验证
  → 用户返回项目页面
  → 网站预览自动显示新 hero 图片 ✓
```

## 优先级实现

### MVP（最小化可行产品）

1. ✅ 在 Unsplash 搜索结果中显示"应用到 Hero"按钮
2. ✅ 实现 `applyImageToHero` Server Action
3. ✅ 在项目主页显示当前 hero 图片
4. ✅ 网站预览实时更新

### 后续增强

- 图片裁剪工具（应用前编辑构图）
- Hero 图片历史记录
- 批量应用（多个 hero 变体）

## 常见问题排查

| 问题 | 解决 |
|------|------|
| 图片不显示 | 检查 hero_image_url 是否存储为完整 HTTP(S) URL |
| 预览未更新 | 检查 revalidatePath，确保路由正确 |
| 权限错误 | 验证 User 认证和项目所有权检查 |
| 图片加载慢 | Unsplash URLs 由 CDN 提供，应该很快；检查网络 |

## 完成标志

✓ `applyImageToHero` Server Action 创建完成
✓ 素材库或 Unsplash 搜索中显示"应用到 Hero"按钮
✓ 项目主页显示当前 hero 图片预览
✓ 网站预览自动显示新图片
✓ `npm run build` 无错误

---

**提交**：完成后回复 "✅ Unsplash 到 Hero 集成完成" + 可选的实现细节或问题。
