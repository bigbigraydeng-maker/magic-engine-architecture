# CTS · Conversion Tracking 修复 SOP（Google Ads + Meta CAPI）

> **执行人**：PM
> **预估工时**：2-3 小时（含 24h 数据观察）
> **完成证据**：Google Ads + Meta Events Manager 都能看到真实询盘转化数据
> **触发事故**：2026-06-10 Day 1 上线 Campaign 跑出 9 click 但 **0 conversion** — 转化追踪没在收数据
> **复用基础**：Oztop `docs/clients/oztop/2026-06-11-pre-launch/01-conversion-tracking-sop.md` 通用流程（Step 1-9 都可借用）

---

## 0 · CTS vs Oztop 关键差异（先对齐再动手）

| 维度 | Oztop（4 个 Conversion）| **CTS（本文档 · 1 个 Primary + Meta CAPI）**|
|---|---|---|
| Conversion 数 | 4（free measure / quote / phone / WhatsApp）| **1（Contact Form Submit）**|
| Lead 平均价值 | AU$500 / 300 / 200 / 100 | **NZ$300**（询盘 → 14-90 天定团 转化率 ~5%）|
| thank-you 页 | `/contact/thank-you/` 需 FDE 建 | **`/thank-you/` 已存在 ✅**（CTS 网站 sitemap 显示）|
| CMS | WordPress + WooCommerce | **Next.js + git 仓 ChinaTravel**（不在 ME 仓）|
| Phone Call | 重要 | 不太重要（询盘 form 是主入口）|
| WhatsApp | 用 | 不用 |
| Meta Pixel + CAPI | 全新装 | **可能已装**（需 PM 验证 Phase 18.A 之前的工作）|
| gtag/GTM | 需新装 | **可能已装**（需 PM 验证 6/10 那次 Campaign 上线时是否装了 gtag）|

⚠️ **关键确认**：6/10 Campaign 上线 9 click 0 conversion 的真因不明 — 是 gtag 没装？是装错位置？是 form 没 redirect？需要 PM 先做 audit（Step 1.0）。

---

## Step 1.0 · 现状 Audit（30 min）

PM 在动手装新东西**之前**，先排查 6/10 Day 1 的 conversion 0 是什么造成的。

### 1.0.1 · 走一遍完整询盘路径

1. 隐身窗口访问 https://www.ctstours.co.nz/
2. 点 Contact / Enquire button
3. 填测试 form（用真实邮箱可以收 confirmation）
4. 提交
5. **关键观察**：跳转到哪个 URL？
   - `/thank-you/` ✅ 期望
   - `/contact/` 留在原页 ⚠️ 没 redirect
   - 别的 URL ⚠️ 路径错

### 1.0.2 · Chrome DevTools 看 gtag 装没装

1. 打开 thank-you 页（或 form 提交成功后所在页）
2. F12 → Network → 输入 `googletagmanager` 过滤
3. 看是否有 `gtm.js` 或 `gtag/js` 加载请求
   - ✅ 有 → gtag 装了，可能是 trigger 配置问题
   - ❌ 没有 → gtag 根本没装到 CTS 网站

### 1.0.3 · 查 Phase 18.A Meta Ads 上线时的配置

参考 ROADMAP `Phase 18.A — Meta Ads MVP ✅ 已完成（2026-05-31）`。

**问 ChinaTravel 仓**（PM 本地或问李白）：
- ChinaTravel 仓 `src/app/layout.tsx` 或 `_app.tsx` 是否注入了 Google gtag？
- 是否注入了 Meta Pixel？
- 是否装了 Meta CAPI server-side（可能在某个 API route 里）？

⚠️ 如果发现已经装了 gtag + Pixel + CAPI → 跳到 Step 2 直接 audit + 修配置
⚠️ 如果发现没装 → 走 Oztop 01 SOP 全套流程，但用 Next.js 注入方式（不是 WP plugin）

---

## Step 1.1 · 拿 IDs（10 min）

| 项 | 来源 | 谁拿 |
|---|---|---|
| Google Ads Conversion ID（AW-XXX）+ Label | Google Ads 后台 6/10 建的 "Contact Form Submit"，应该已有 | PM 操作 |
| GA4 Measurement ID（G-XXXXXXX）| ME admin → CTS client → analytics tab（A2.1 已配过）| PM 查 |
| Meta Pixel ID | Meta Events Manager → Data Sources | PM 查 |
| Meta Conversions API Access Token | Meta Events Manager → Settings → Generate（如果有就复用，没有新建）| PM 查/生成 |

---

## Step 2 · ChinaTravel Next.js 注入 gtag/GTM（30-45 min）

⚠️ **跟 Oztop 不一样的关键点** — CTS 不能用 WP plugin。要么改 ChinaTravel 仓代码，要么用 GTM 容器塞 head。

### 2.1 · 推荐方式 A · GTM 容器 + ChinaTravel 注入容器代码

1. 进 GTM `tagmanager.google.com` → 找 CTS 容器（如果之前建过）或新建 "CTS Tours NZ — Production"
2. 拿 GTM-XXXXXXX
3. 修改 ChinaTravel 仓 `src/app/layout.tsx`：

```tsx
import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager */}
        <Script
          id="gtm-head"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','GTM-XXXXXXX');`,
          }}
        />
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {children}
      </body>
    </html>
  )
}
```

4. ChinaTravel 仓 PR + merge + Render auto-deploy
5. 24h 后访问 ctstours.co.nz F12 → 看到 gtm.js 加载 ✅

### 2.2 · 替代方式 B · Next.js Script 组件直接装 Google gtag（不用 GTM）

```tsx
<Script
  src="https://www.googletagmanager.com/gtag/js?id=AW-XXXXXXXXXX"
  strategy="afterInteractive"
/>
<Script
  id="gtag-init"
  strategy="afterInteractive"
  dangerouslySetInnerHTML={{
    __html: `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'AW-XXXXXXXXXX');
      gtag('config', 'G-XXXXXXX');  // GA4
    `,
  }}
/>
```

**优势**：直接，不需 GTM 容器
**劣势**：以后改 conversion 配置要改代码 + 重新部署（vs GTM 后台改就行）

**推荐**：方式 A（GTM）— 长期维护成本低。

⚠️ **强约束**：gtag/GTM 必须装 ctstours.co.nz，**绝禁** 装 magicengine.* 子域名

---

## Step 3 · Google Ads Conversion Action（已存在则 audit）

如果 6/10 已经建了 Contact Form Submit conversion：

### 3.1 · audit 当前配置

Google Ads → Tools → Conversions → 找 "Contact Form Submit"：
- [ ] Status: Active ✅
- [ ] Source: Website
- [ ] Category: Lead ✅
- [ ] Value: NZ$300 (推荐) 或 "Use the same value: NZ$300"
- [ ] Count: One
- [ ] Click-through window: 30 days
- [ ] Attribution model: Data-driven
- [ ] Mark as Primary: ✅

如果 value 还是 0 或 1 → 改成 NZ$300

### 3.2 · 拿 Conversion ID + Label

存档备用：
```
Google Ads Conversion ID:    AW-______________
Conversion Label:            ______________
```

---

## Step 4 · GTM 配 Tag（30 min）

### 4.1 · Tag · Contact Form Submit

进 GTM → Tags → New → "Google Ads Conversion Tracking" 类型：
- Conversion ID: `AW-XXXXXXXXXX`
- Conversion Label: Contact Form Submit label
- Conversion Value: `300` (NZD)
- Currency: `NZD`
- **Triggering**: Page View where Page URL contains `/thank-you/`

### 4.2 · 触发器（Trigger）

GTM → Triggers → New → Page View
- Trigger Type: Page View
- This trigger fires on: Some Page Views
- Page Path **matches RegEx** `^/thank-you/?$`

⚠️ 严格匹配 — 防止 `/thank-you-extra/` 等误命中

### 4.3 · 也注入 GA4 Tag

进 GTM → Tag → "Google Analytics: GA4 Configuration":
- Measurement ID: `G-XXXXXXX`
- Triggering: All Pages

GTM → Tag → "Google Analytics: GA4 Event":
- Configuration Tag: 上面建的 GA4
- Event Name: `lead`
- Event Parameters:
  - `currency`: `NZD`
  - `value`: `300`
- Triggering: 同 Step 4.1 Page View

### 4.4 · GTM Publish

GTM → Submit → 命名 "CTS Conversion Tracking — Initial setup 2026-06-11" → Publish

---

## Step 5 · Meta Pixel + CAPI 接入（45 min）

### 5.1 · Meta Pixel（browser-side via GTM）

GTM → Tag → New → Custom HTML 类型
- HTML 内容（从 Meta Events Manager 拿 base code）：

```html
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'XXXXXXXXXXXXXXX');  // ← 替换 Pixel ID
fbq('track', 'PageView');
</script>
```

- Triggering: All Pages

### 5.2 · Meta Lead Event Tag

GTM → Tag → New → Custom HTML：

```html
<script>
const eventId = (crypto.randomUUID && crypto.randomUUID()) || (Math.random().toString(36).slice(2));

fbq('track', 'Lead', {
  value: 300,
  currency: 'NZD',
  content_name: 'contact_form_submit'
}, {eventID: eventId});

// Store eventId for CAPI deduplication (passed via dataLayer to server)
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'meta_lead_with_event_id',
  meta_event_id: eventId,
});
</script>
```

- Triggering: 同 thank-you Page View（Step 4.2）

### 5.3 · Meta Conversions API (server-side)

⚠️ CAPI 是 server-side 调用，**不能从 GTM 容器直接发**。两种路径：

**路径 A · ChinaTravel 仓加一个 API route 中转**（推荐）

在 ChinaTravel 仓建 `src/app/api/meta-capi/lead/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const eventId = body.eventId
  const userAgent = req.headers.get('user-agent') ?? ''
  const ipAddress = req.headers.get('x-forwarded-for') ?? ''

  const META_PIXEL_ID = process.env.META_PIXEL_ID_CTS
  const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN_CTS

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [
          {
            event_name: 'Lead',
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: 'https://www.ctstours.co.nz/thank-you/',
            user_data: {
              client_user_agent: userAgent,
              client_ip_address: ipAddress,
            },
            custom_data: {
              value: 300,
              currency: 'NZD',
              content_name: 'contact_form_submit',
            },
          },
        ],
      }),
    },
  )

  return NextResponse.json(await res.json())
}
```

### 5.4 · 在 thank-you 页 client-side 触发 CAPI

ChinaTravel 仓 `src/app/thank-you/page.tsx`（或 layout）加：

```tsx
'use client'
useEffect(() => {
  const eventId = (window as any).dataLayer?.find((e: any) => e.event === 'meta_lead_with_event_id')?.meta_event_id
  if (eventId) {
    fetch('/api/meta-capi/lead', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => { /* CAPI 失败不影响用户体验 */ })
  }
}, [])
```

### 5.5 · 环境变量配 Render

ChinaTravel Render env：
```
META_PIXEL_ID_CTS=XXXXXXXXXXXXXXX
META_CAPI_TOKEN_CTS=EAAxxxxxxxx...
```

---

## Step 6 · 端到端验证（30 min）

### 6.1 · 走一遍真实询盘

1. 隐身窗口访问 https://www.ctstours.co.nz/contact/
2. 填测试 form → 提交
3. 跳转到 `/thank-you/`
4. **Google Tag Assistant Companion** 应该亮：
   - GTM-XXXXXXX 已 fire ✅
   - Google Ads Conversion (Contact Form Submit) 已 fire 绿勾 ✅
   - Conversion Value: 300 NZD ✅
5. **Meta Events Manager → Test Events** 应该显示：
   - `Lead` event 来自 Browser + Server 双源 ✅
   - **Event Deduplication 绿勾**（说明 event_id 配对成功）✅
   - Value: 300 NZD ✅

### 6.2 · 24h 后 Google Ads 后台

24h 后看 Google Ads → Conversions → Contact Form Submit：
- "Conversions" 列出现 ≥1 真实数字 ✅

### 6.3 · 24h 后 Meta Events Manager

Meta Events Manager → Diagnostics 全绿：
- ✅ Pixel matching
- ✅ CAPI receiving events
- ✅ Event Deduplication active
- ✅ EMQ ≥ 6.0

---

## Step 7 · Day 1 vs 6/10 上线对比

6/10 Campaign 1 上线 9 click 0 conversion 的真因，应该在 Step 1.0 audit 后清楚：

| 可能 | 修法 |
|---|---|
| A. gtag 根本没装到 ctstours.co.nz | Step 2 装 GTM |
| B. gtag 装了但 thank-you trigger 配错 | Step 4 改 Trigger |
| C. form 提交后不 redirect 到 /thank-you/ | ChinaTravel 仓改 form behavior |
| D. Conversion Action 的 Conversion Label 跟 GTM 配置不一致 | Step 3 + 4 对齐 ID |

---

## Step 8 · 修好后 → Day 2 重新上 Campaign（之前 Campaign 1 也可保留）

- Campaign 1（品牌防御）已经在跑，conversion 配通后历史数据补回（Google Ads 自动回溯 7 天点击 → conversion 时间）
- Campaign 2（行业获客 NZ$1,200/月）+ Campaign 3（Display Remarketing NZ$450/月）+ Meta Campaign（NZ$900/月）等 Conversion 跑通 + Smart Bidding 学到数据后再上

**强约束**：**0 Conversion = 0 Smart Bidding**。Conversion 没修好之前不要上 Campaign 2/3。

---

## Step 9 · ID + Token 存档

```
================================================
CTS Conversion Tracking — 配置档案
日期：2026-06-XX
================================================

Google Ads:
- Account ID:           105-817-1329
- Conversion ID:        AW-______________
- Conversion Label:     ______________  (Contact Form Submit)

Google Tag Manager:
- Container ID:         GTM-_______
- Workspace:            Production
- Published version:    v1.0 (2026-06-XX)

Meta:
- Pixel ID:             _______________
- CAPI Access Token:    (存 Render env: META_CAPI_TOKEN_CTS)
- Test Event Code:      TEST______（仅测试期用）

GA4:
- Measurement ID:       G-__________

ChinaTravel Repo:
- src/app/layout.tsx       注入 GTM
- src/app/api/meta-capi/lead/route.ts  Meta CAPI 中转
- src/app/thank-you/page.tsx  触发 CAPI 调用

Render env (ChinaTravel):
- META_PIXEL_ID_CTS=_______________
- META_CAPI_TOKEN_CTS=_______________

================================================
PM 验证签字：_____________  日期：_______
================================================
```

---

## 跟 Oztop Conversion SOP 的关键差异（再次强调）

| 维度 | Oztop（01 SOP）| CTS（本 SOP）|
|---|---|---|
| Conversion 数 | 4 | 1 |
| CMS | WordPress + plugins | **Next.js + git 仓代码改** |
| GTM 装法 | WP plugin GTM4WP | **Next.js Script 组件** |
| Meta CAPI 装法 | PixelYourSite Pro | **ChinaTravel API route 中转** |
| thank-you 页 | 需 FDE 在 WP 建 | **CTS 已有 /thank-you ✅** |
| Phone Call | 重要 | 不重要 |
| Render env | （ME / Oztop WordPress 独立环境）| **ChinaTravel 仓 Render env** |

---

## 跟子牙窗口 #2 的协调

子牙窗口 #2 在修 ME keyword-relevance Bug 1。**互相不影响**：

- 子牙动 magic-engine 仓 `src/lib/seo-intelligence/`
- CTS Conversion 修复动 **ChinaTravel 仓**（不在 magic-engine 仓）
- 两个 PR 在不同仓，绝对不冲突

**你可以同时跑**：子牙窗口 #2 + 本 CTS Conversion 修复 + Oztop 上产工作（路径 X 等子牙 Bug 1 fix）

---

**PM 下一步**：

1. Step 1.0 audit — 确认 6/10 Conversion 0 的真因（30 min）
2. Step 1.1 拿 4 个 ID + 决定 GTM 装法 A 还是 B（10 min）
3. Step 2-5 装好 gtag + Pixel + CAPI（2h，跨 ChinaTravel 仓）
4. Step 6 端到端验证（30 min）
5. 24h 后回报 Google Ads + Meta 两边数字 → 我接 Campaign 2/3 + Meta 上线 checklist
