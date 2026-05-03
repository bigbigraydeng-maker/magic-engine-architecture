# Cursor 实现任务：TradeMe 房源提取优化

## 目标

在 HiBiz 中实现 TradeMe 房源提取的三个改进：
1. **质量检测门** — 防止空数据进入 LLM，明确告知用户抓取失败
2. **`__NEXT_DATA__` 优先层** — Next.js 页面源码直解析，零 LLM 成本
3. **图片代理到 Supabase Storage** — 绕防盗链，长期保存

---

## 架构

```
用户粘贴 TradeMe URL
  ↓
尝试 Layer 1: __NEXT_DATA__ 解析（新增）
  ↓ [失败则降级]
尝试 Layer 2: Jina Reader + OpenAI（现有管线）
  ↓
ExtractionQualityGate 质量评估（新增）
  ↓ [quality grade = "failed"]
返回明确错误给用户
  ↓ [quality grade = "good" / "partial"]
图片代理到 Supabase Storage（新增）
  ↓
写入 merchant_profile + draft_model
```

---

## 实现清单

### 1️⃣ ExtractionQualityGate（质量检测）

**新增文件**：`src/lib/extraction/quality-gate.ts`

```typescript
export interface ExtractionQuality {
  score: number;       // 0-100
  grade: "good" | "partial" | "failed";
  missing: string[];
}

export function assessExtractionQuality(listing: TradeMeListingData): ExtractionQuality {
  // 实现：
  // - title 长度 > 10 → +20 分
  // - description > 50 chars → +25 分
  // - images >= 2 → +25 分，或 = 1 → +10 分
  // - bedrooms != null → +10 分
  // - price_hint → +10 分
  // - address → +10 分
  //
  // grade 判定：
  // - >= 60 → "good"
  // - 30-59 → "partial"
  // - < 30 → "failed"
  //
  // missing: 列出缺失的字段（用于 UI 提示）
}
```

**使用位置**：`src/app/app/projects/merchant-profile-actions.ts` 中 `importListingFromUrl`
- 提取后调用 `assessExtractionQuality(listing)`
- 如果 grade = "failed" → `redirect(...?notice=listing_extraction_failed&missing=X,Y,Z)`
- 如果 grade = "partial" → 继续但通过 notice 传递 missing 信息，前端 toast 提示

---

### 2️⃣ `__NEXT_DATA__` 解析层（零成本提取）

**新增文件**：`src/lib/extraction/extract-next-data.ts`

**函数签名**：
```typescript
export async function extractFromNextData(url: string): Promise<TradeMeListingData | null>
```

**实现步骤**：
1. `fetch(url)` 获取 HTML
2. 正则提取 `<script id="__NEXT_DATA__" type="application/json">{...}</script>`
3. JSON.parse，在 `pageProps` 或 `props` 中找到 listing 数据
4. **参考 TradeMe Next.js 页面结构**：通常 `pageProps.listing` 或类似路径
5. 映射到 `TradeMeListingData` schema（注意字段名可能不同）
6. 返回或失败返回 null（fallback 到 Jina）

**关键点**：
- 需要 defensive parsing（页面结构可能变）
- 测试用例：至少一个真实 TradeMe property URL
- 失败 log（便于后续调试）

**使用位置**：新增 `src/lib/extraction/extraction-layers.ts` 统一调度
```typescript
export async function extractTradeMeListingMultiLayer(url: string): Promise<ExtractTradeMeListingResult> {
  // 1. 尝试 __NEXT_DATA__
  const nextDataResult = await extractFromNextData(url);
  if (nextDataResult) {
    return { listing: nextDataResult, markdown: "" };  // markdown 为空（无需 poster blurb LLM）
  }

  // 2. 降级到 Jina + OpenAI（原有 extractTradeMeListing）
  return extractTradeMeListing(url);
}
```

然后修改 `importListingFromUrl` 中的调用：
```typescript
// 旧：const extracted = await extractTradeMeListing(url);
// 新：
const extracted = await extractTradeMeListingMultiLayer(url);
```

---

### 3️⃣ 图片代理到 Supabase Storage

**新增文件**：`src/lib/extraction/image-proxy.ts`

**函数签名**：
```typescript
export async function proxyImagesToStorage(
  imageUrls: string[],
  projectId: string,
  supabase: SupabaseClient,
): Promise<string[]>
```

**实现**：
- 遍历 `imageUrls`（最多 12 张）
- 对每张 URL：
  1. `fetch(url, { headers: { Referer: "https://www.trademe.co.nz/" } })`（绕防盗链）
  2. 超时 10s，失败则跳过（不阻塞）
  3. 写入 Supabase Storage bucket `listing-images`
  4. 生成 public URL，添加到结果数组
- 返回代理后的 URL 列表

**Supabase Storage 设置**（如未创建）：
- Bucket 名：`listing-images`
- 设为 public
- 路径规则：`{projectId}/{uuid}.{ext}`

**使用位置**：`src/app/app/projects/merchant-profile-actions.ts` 中 `importListingFromUrl`

```typescript
// 提取后、存储前
const proxiedImages = await proxyImagesToStorage(listing.images, projectId, supabase);
listing.images = proxiedImages;  // 替换为代理 URL
```

---

## 修改清单

### 修改：`src/lib/extraction/extract-listing.ts`
- 保持原样（Layer 2 fallback）
- 可选：移到新的 `extraction-layers.ts` 中供调度

### 修改：`src/app/app/projects/merchant-profile-actions.ts`
```typescript
// importListingFromUrl 函数中：

// 1. 调用新的多层提取
const extracted = await extractTradeMeListingMultiLayer(url);
const listing = extracted.listing;
const markdown = extracted.markdown;

// 2. 质量检测
const quality = assessExtractionQuality(listing);
if (quality.grade === "failed") {
  redirect(`/app/projects/${projectId}?notice=listing_extraction_failed&missing=${quality.missing.join(",")}`);
}

// 3. 图片代理
const proxiedImages = await proxyImagesToStorage(listing.images, projectId, supabase);
listing.images = proxiedImages;

// 4. 继续现有逻辑（生成 poster blurb，写入数据库）
// ...
```

### 新增：`src/lib/extraction/extraction-layers.ts`
- 导出 `extractTradeMeListingMultiLayer`（多层调度）

### 新增：`src/lib/extraction/quality-gate.ts`
- 导出 `assessExtractionQuality`

### 新增：`src/lib/extraction/image-proxy.ts`
- 导出 `proxyImagesToStorage`

---

## 测试清单

- [ ] `__NEXT_DATA__` 解析正确识别一个真实 TradeMe property URL
- [ ] 质量检测：输入空数据 → grade = "failed"
- [ ] 质量检测：输入完整数据 → grade = "good"
- [ ] 质量检测：输入部分数据 → grade = "partial"
- [ ] 图片代理：至少代理成功 1 张图（验证 Supabase Storage 公网可访问）
- [ ] 集成测试：完整流程 URL → extraction → quality gate → proxy → save

---

## 注意事项

1. **Render 部署**：Root Directory 已设为 `hibiz/`（由 Claude 配置）
2. **Supabase Storage**：需要在控制面板创建 `listing-images` bucket（如未存在）
3. **防盗链 Header**：Referer 必须是 `trademe.co.nz`（否则 403）
4. **Defensive Parsing**：`__NEXT_DATA__` 可能因页面版本变更而失效 → 依赖 fallback 机制
5. **不触发 Poster Blurb LLM**：若用 `__NEXT_DATA__` 直解析，`markdown` 为空 → `generatePosterBlurbs` 应检查 markdown 长度

---

## 调试技巧

- 在 `extractFromNextData` 中 log `__NEXT_DATA__` 提取结果，便于检查页面结构变更
- 在 `proxyImagesToStorage` 中 log 代理成功/失败计数
- 质量检测分数在 notice 中返回，便于观察评分逻辑是否合理

---

**完成后更新 dev-progress.ts**：
- `trademe-extract-v2` 改为 `"done"`
- `image-proxy` 改为 `"done"`
- 更新 `DEV_PROGRESS_LAST_UPDATED`

