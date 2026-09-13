# CTS Tailor-made 画册模板

面向 **最终客户** 的定制画册（picture book）。行程单回答「每天去哪、住哪、多少钱」，
画册回答「这些地方长什么样、为什么值得去」—— 大图 + 英文介绍，用来在客户掏钱之前先让他动心。

行程单模板的姊妹件，见 [`../tailor-made-itinerary/README.md`](../tailor-made-itinerary/README.md)。
两者共用同一套设计变量、同一套数据注入机制，也共用同一份报价单记录。

```
templates/tailor-made-brochure/
├── brochure-template.html      ← 模板本体（版面 + 自动分页）
├── attraction-library.json     ← 英文景点文案素材库（中国线）
└── README.md
```

---

## 1. 后台怎么用

后台 → 客户 → 行程单 → 打开一份报价单 → 切到 **画册** 标签页。

左边填内容，右边就是成品本身（不是缩略图 —— 那个 iframe 里的 HTML 就是导出的 PDF）。
填完点「导出 PDF」，浏览器打印对话框里目标选「存储为 PDF」、边距选「无」、勾选「背景图形」。

城市、日期、客户名、报价编号都从行程单继承，不用重填。

---

## 2. 文档结构

| 页 | 内容 |
|---|---|
| 1 | **封面** — 满版大图 + logo + 标题 + 城市带 + 三栏事实 + Prepared for + 报价编号 |
| 2 | **总览** — 开篇介绍 + 四城路线带 + 提示框 |
| 3+ | 每个城市：**整版大图开篇**（城市名压在图上 + 该城代表景点的介绍 + 住宿/交通速览），后面跟 **景点卡片页**（每页 4 张） |
| 末页 | **结尾** — 下一步 + 联系方式 + 图片版权 + 落款 |

**页数不固定**：一个城市放 3 个还是 9 个景点都排得下，模板按内容自动分页
（`flow()` 先离屏量高度、再探测每页可用高度、然后流式填页）。城市标题不会孤立地
留在页尾（`keepNext`）。这是纯 CSS 分页做不到的。

---

## 3. 数据 Schema

契约定义在 [`src/lib/tailor-made/brochure-types.ts`](../../src/lib/tailor-made/brochure-types.ts)，
改那里就必须同步改模板，反之亦然。

```jsonc
{
  "cover": {
    "image": "",            // 封面大图 URL
    "eyebrow": "TAILOR-MADE JOURNEY",
    "title": "Four Cities, Fifteen Days",
    "cities": ["BEIJING", "XI'AN"],
    "meta": [{ "label": "DEPARTS", "value": "1 November" }],
    "footNote": "A companion to your itinerary"
  },
  "overview": {
    "eyebrow": "Your journey",
    "title": "",
    "intro": "",
    "note": { "title": "", "body": "" }
  },
  "cities": [{
    "name": "Beijing",
    "days": "DAYS 02 – 05",
    "hero": { "image": "", "title": "", "caption": "", "body": "" },
    "glance": [{ "label": "Nights", "value": "" }],
    "blocks": [
      { "image": "", "day": "Day 04", "title": "", "body": "" },  // 景点卡片
      { "eyebrow": "", "title": "", "body": "" }                   // 说明面板（无图）
    ]
  }],
  "closing": { "eyebrow": "Next", "title": "", "body": "", "signOff": "" },
  "credits": [{ "author": "David290", "license": "CC BY-SA 4.0" }]
}
```

`preparedFor`、`quoteRef`、`logo`、`creditLine` 由
[`brochure-render.ts`](../../src/lib/tailor-made/brochure-render.ts) 注入，不存在 payload 里 ——
客户名只有一处来源（报价单），改一次两份文件都跟着变。

**说明面板**（无图那种）存在的理由是版面：一页排 4 张卡片，某城只有 3 个景点时右下角会空一格，
与其留个洞不如放一段「本城注意事项」。顾问真有话要说，客户也真会看。

---

## 4. 图片

图片走 URL（Supabase 公开链接即可），模板不内嵌。

⚠️ **本机用浏览器直接打开这个模板时，`file://` 的图片不会显示** —— Chrome 不允许
`file://` 页面加载 `file://` 的 CSS 背景图，加 `--allow-file-access-from-files` 也不行。
后台里用的是 https 链接，不受影响；本机调版面时把图换成 `data:` URI。

**版权**：用了 Wikimedia 等 CC 授权图就必须在 `credits` 里署名 —— 这是发给付费客户的文件，
漏署名是许可违约，不是排版瑕疵。自家拍的图不用填。署名行由
`buildCreditLine()` 生成并渲染在末页。

---

## 5. 景点文案素材库

`attraction-library.json` 存中国线各城市的英文景点介绍，顾问在编辑器里「从素材库选」直接取用。

**库里只有文案，没有图片**，这是故意的：每次重写最费时的是英文介绍，图片各家旅行社有自己的资产，
配自家的图画册才是自己家的。

库是**行业级素材**（任何做中国线的旅行社都能用），所以放模板目录，不放客户配置。
加新城市/新景点直接往 `cities[].entries[]` 里加即可，不用改代码。

---

## 6. 设计规范

与行程单模板完全一致（同一套 `:root` 变量，源自 `tailwind.config.ts`）：

| 项目 | 值 |
|---|---|
| 主红 | `#B61E2E` |
| 金 | `#D6A756` |
| 正文墨色 / 次要 | `#23201C` / `#5A554F` |
| 米色底 | `#FBF7F0` |
| 标题字 | Playfair Display（回落 Georgia） |
| 正文字 | Inter（回落 Helvetica Neue） |
| 版面 | A4，左右页边距 16mm |

logo 从 [`../shared/cts-brand-assets.json`](../shared/cts-brand-assets.json) 注入。
行程单模板目前仍内嵌自己那份 logo 副本 —— 换 logo 时两处都要改。
