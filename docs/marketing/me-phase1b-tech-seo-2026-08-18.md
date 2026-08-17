# Magic Engine — Phase 1B 技术型 SEO 外科手术式修正

- **日期**：2026-08-18
- **父 Issue**：#1041（Phase 0 T0 baseline）
- **本次 Issue**：#1053（Phase 1B）
- **姐妹 PR**：#1043（T0 receipt v1）· #1051（T0 receipt v0.6b 完成 18/18）· #1052（Phase 1A 计量插桩，待完成）
- **分支**：`research/me-phase1b-tech-seo`（从 `origin/main` 建出，未合并、未部署）
- **风险等级**：C（marketing 静态站，纯结构性 HTML/XML 微调；无代码、无 schema、无对客户体验的正向改动依赖）

---

## 硬边界（本 PR 严格遵守）

- 未生成任何 SEO/positioning 文案；无 keyword stuffing
- 未新增 `/insights/` `/research/` `/case-studies/` 或任何 money page
- 未改动 `magicengine_geo_baseline_v1` 查询集
- 无客户业务数据触碰
- 未 merge、未 deploy —— 停在 Draft PR
- Entity Definition v1（#1049）未合并，本 PR 不做 positioning 声明

---

## 5 项 scope 逐项裁决

### 1. `website/ai-growth-engine.html` 空 h3 / 模板缺陷

**裁决**：跳过（finding 复现失败）

**取证**：

- 全文 grep `<h[1-6][^>]*></h[1-6]>` = 0 match
- 页面结构：4 个 DAPE h3（Discover/Analyse/Prescribe/Execute，均填满 caption）+ 3 个行业卡 h3（Real Estate/Travel/Local Services，均带超链）+ 3 个 FAQ details，共 7 个非空 h3
- 已有 canonical、og、JSON-LD（Service + FAQPage）
- 6.3 KB 源于 HTML 全部一行压缩，非缺内容

Phase 0 的「3 个空 h3」判据在当前 origin/main 上不成立。若要重构该页，属正向内容工作，不在 Phase 1B 手术范围。

pre-state sha256：`c96efd313651e0a4fe3d988803bbb0868f07acac2772de8dd6007998636f331d`

---

### 2. `/features` nav 与 sitemap 不一致（#1039）

**裁决**：完成 —— 加入 sitemap（footer/nav 均引，且页面 canonical、hreflang、CN 对偶均已就绪，语义上是正式页）

**证据**：

- 引用来源：`website/index.html`（footer Solutions 列）、`website/privacy.html`、`website/terms.html`、`website/features.html`（自引 nav 高亮）
- CN 对偶存在：`website/cn/features.html` 有独立文件、独立 canonical

**改动**：

- `website/sitemap.xml`：新增 `/features` 和 `/cn/features` 两条 `<url>`，`lastmod=2026-08-18`
- `xmllint --noout` 通过

sitemap pre-state sha256：`5705399fc17f15881c74a924b8ee68ed1465b363e8634c32bc1a9c8a838bdaae`
sitemap post-state sha256：`61f1feb00f9247e942abb9f930ca611894c77430d264f490782febac1d781ea7`

---

### 3. hreflang 修正

**裁决**：完成 —— 只在真存在语言对偶的页上，补齐 `x-default`

**探查**（scope 要求先看 `website/cn/`）：EN 侧 16 个页面均在 `website/cn/` 有对偶文件，且均已声明 `hreflang="en"` 与 `hreflang="zh-Hans"`。真缺口在 `x-default`（13/16 EN 页缺，3/3 CN 对偶页也缺）。

本 PR 只在 3 个目标页（features/discover/about，与 item 4 同一批）EN + CN 两侧补 `x-default`，保证 hreflang cluster 双向对称。其余 10 对页保持原状，留给独立小 PR 处理。

**改动的 6 个文件**：

| 文件 | 新增行 |
|---|---|
| `website/features.html` | `<link rel="alternate" hreflang="x-default" href="https://magicengine.com.au/features">` |
| `website/discover.html` | `<link rel="alternate" hreflang="x-default" href="https://magicengine.com.au/discover">` |
| `website/about.html` | 已有 x-default，未动此行；本次只加 JSON-LD |
| `website/cn/features.html` | `<link rel="alternate" hreflang="x-default" href="https://magicengine.com.au/features">` |
| `website/cn/discover.html` | `<link rel="alternate" hreflang="x-default" href="https://magicengine.com.au/discover">` |
| `website/cn/about.html` | `<link rel="alternate" hreflang="x-default" href="https://magicengine.com.au/about">` |

**验证**：6 个文件 `hreflang` 三元组齐全（en / zh-Hans / x-default），且 CN 与 EN 双向指向同一 EN URL 作 x-default，符合 Google 官方 hreflang 集群定义。

---

### 4. 3 个高意图页加 JSON-LD

**裁决**：完成 —— 3 个页均加，内容全部 grounded 在页面已有可见文本，无自造 positioning 语。

| 页面 | 加入的 @graph 类型 | grounding 依据 |
|---|---|---|
| `website/discover.html` | `WebPage` + `Service` | h1 "Run your free diagnosis"；p "scan your Google presence, AI mentions, social footprint, ad signals and reviews"；Free · No sign-up required |
| `website/about.html` | `AboutPage` + `Organization` | h1 "About Magic Engine"；页面 h2 "Who we are/Our name/What we do/Who we serve/Contact"；contact email 来自页面 `raydeng@magicengine.com.au` |
| `website/features.html` | `WebPage` + `ItemList`（10 项） | 页面 10 个 h3 逐字：Google Ads / Meta (Facebook & Instagram) / Campaign health report / Performance trends / AU/NZ benchmarking / EOFY opportunity window / AI-generated optimisations / Approval-first execution / Ad creative generation / Cross-platform coordination |

**未做**：

- 未加 `sameAs`（社媒 URL 未在页面出现，避免自造）
- 未加 legalName / address（虽 index footer 里有 "ABC Plus Home Pty Limited · ABN 45 674 442 445 · 98 Beatrice Ave..."，但 /about 页面本身未出现，为保守 grounding 一律不带入）
- 未在 CN 对偶页加对应中文 JSON-LD（scope 明确只列 3 个 EN 页；CN 侧可另开 PR）

**验证**：三处 `<script type="application/ld+json">` 用 `JSON.parse` 逐个解析，无异常。类型分别：`WebPage,ItemList` / `WebPage,Service` / `AboutPage,Organization`。

---

### 5. sitemap `lastmod` 校正

**裁决**：完成 —— 只在本 PR 实际改动 HTML 的 URL 上更新到 `2026-08-18`，其余保持原值不动。

**改动的 6 条 `lastmod`**：

| URL | 旧 lastmod | 新 lastmod | 理由 |
|---|---|---|---|
| `/about` | 2026-06-02 | 2026-08-18 | 本 PR 加 JSON-LD |
| `/features` | （不在 sitemap） | 2026-08-18 | 本 PR 首次登记 + 加 JSON-LD |
| `/discover` | 2026-06-02 | 2026-08-18 | 本 PR 加 JSON-LD + x-default |
| `/cn/about` | 2026-06-02 | 2026-08-18 | 本 PR 加 x-default |
| `/cn/features` | （不在 sitemap） | 2026-08-18 | 本 PR 首次登记 + 加 x-default |
| `/cn/discover` | 2026-06-02 | 2026-08-18 | 本 PR 加 x-default |

**明确未做**：其余 28 条 sitemap URL 的 `lastmod` 一律保留原值（大多是 2026-06-02 与 2026-08-05）。scope 明说「Do NOT stamp fake 'today' dates across the site」——遵守。

---

## 预/后状态 sha256（8 个受影响文件）

| 文件 | pre | post |
|---|---|---|
| `website/features.html` | `c49695eb98839d008d7ae88ea7cef88418e6d2e902f2f6f1ac3648ac79537b2d` | `c4b1b7dcaa87c34e5605c3563203ff2839b725ae414b5e2add3ca3a1dd1bf8f7` |
| `website/discover.html` | `cd9abe49960f92ad10eea5372d38f525b38ab8493a2ee7f606bebde42d54cf2f` | `ad42eadfff4d452cff7ff1e75691a48136549a4b1ed9cc27f191a1dafd12c46f` |
| `website/about.html` | `372da8725279b797c54b03b12457460e3d0a810a77fc9e8404763aeef4f502ad` | `6e26d32a04dd1bf3e15abd11b81d0064eae178603776b779a9dd6d86b103dbf7` |
| `website/sitemap.xml` | `5705399fc17f15881c74a924b8ee68ed1465b363e8634c32bc1a9c8a838bdaae` | `61f1feb00f9247e942abb9f930ca611894c77430d264f490782febac1d781ea7` |
| `website/cn/features.html` | `81d15f99e3e3dc5905a6096761faf30be0e87c510b40d061dd3def26ab28e3fd` | `d4015b4c71deeaf92a0ee148aa16dab38fd0fd308617d4273e2053d42c1cda7a` |
| `website/cn/discover.html` | `1ac26bb5f0d12fde1cc30e126eb3a12cd022701f3512b285c021c3d13421d441` | `2303469a610b6bf73ca260a68705ae82921fcd5ebdc504c3c36e0b68c8acf42a` |
| `website/cn/about.html` | `597dae1f240329c8d6c1a61a8f8c9873d7f39d14aea2ed7760ccabb18a047fd0` | `2eede6a9750fd83f32fe8ddb9a40272f57efda1b4b64783e3aa559db5086648a` |
| `website/ai-growth-engine.html` | `c96efd313651e0a4fe3d988803bbb0868f07acac2772de8dd6007998636f331d` | 同 pre（未改动） |

---

## 声明

- **本 PR 未包含任何 SEO 声明 / positioning 语 / 商业主张**，全部改动为结构性/技术性（hreflang 三元组、JSON-LD schema.org 标注、sitemap 登记与 lastmod）
- **本 PR 未生成任何内容页**，未新增 money page
- **本 PR 未 merge、未部署到 Cloudflare Pages**；停在 Draft PR，待 #1052 计量插桩完成后再评估合入时机
- 所有 JSON-LD 语料逐字来自受影响页面已经可见的正文/标题/说明；未编造类目、未加未在页面出现的社媒/地址/证书

---

## Hold-until-#1052

按 #1053 PM 指令，此 PR 保持 Draft，等 Phase 1A 计量插桩（#1052）落地后再决定合入节奏 —— 目的是保证 Phase 1B 的每一处改动能被 Phase 1A 的插桩前后对比检测到，避免「改了但没数据佐证」。
