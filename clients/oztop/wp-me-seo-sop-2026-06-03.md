# Oztop · ME + WordPress SEO 标准 SOP

> 日期：2026-06-03
> 适用对象：FDE / PM
> 客户：Oztop Building Supplies
> 目的：把 Magic Engine 作为 WordPress 内容 SEO 生产线来用，稳定完成“生成 -> 检查 -> 推送草稿 -> 发布 -> 收录”

---

## 0. 先说结论：ME 内能做到哪一步

### 已可在 ME 内完成

1. 选关键词 / 选题并生成博客草稿
2. 自动生成 `title` / `meta title` / `meta description` / `slug`
3. 读取站点页面上下文，辅助插入内部链接
4. 对内部链接数量做质量检查
5. 推送到 WordPress Draft
6. 如果 Yoast REST 扩展已启用，自动写入：
   - SEO title
   - Meta description
   - Focus keyphrase
7. 在 ME 内点击 Publish
8. 在 ME 内请求 Google 收录

### 仍需要人工处理

1. 全站技术 SEO：
   - 301 / canonical
   - taxonomy / archive noindex
   - sitemap 清理
   - 首页 / 分类页模板改造
   - 站点速度
2. 首次安装 Yoast mu-plugin
3. WordPress 主题 / Elementor 模板级改动
4. 旧文章批量补 SEO 字段

### 当前最佳使用方式

- 把 ME 当成“新内容生产线”
- 把 WordPress 后台当成“发布确认 + 模板校验台”
- 把技术 SEO 当成独立清单处理，不混在单篇内容发布流程里

---

## 1. 开工前检查

### A. WordPress 连接检查

1. 进入 `Settings -> 网站连接 -> WordPress`
2. 确认状态为 `已连接`
3. 点击 `测试连接`
4. 结果必须是：
   - 账号可访问
   - 具备发文权限

### B. Yoast 检查

1. 在 WordPress 连接卡里点击 `验证安装`
2. 结果分两种：
   - `SEO 扩展已启用`：今天这篇可以让 ME 自动写 Yoast
   - `SEO 扩展未安装`：今天这篇仍可发，但要去 WP 后台手动补 Yoast

### C. 默认分类检查

1. 在 WordPress 连接卡确认默认分类
2. Oztop 博客默认应设为 `Flooring` 对应的分类 ID
3. 如果没设，今天先手动确认一次；后续固定下来

---

## 2. 单篇标准流程

### Step 1：在 ME 建立文章任务

1. 进入 `Oztop -> Blog Studio`
2. 输入：
   - `topic`
   - `primary keyword`
   - `mode`
3. 规则：
   - 场景词、比较词、成交词优先
   - 默认用 `unified`
   - 只有当这篇明显更偏 AI 推荐训练时，才用 `geo_only`

### Step 2：生成后先看 6 个地方

1. 标题是否包含主关键词
2. `meta title` 是否清晰、可点击
3. `meta description` 是否有 CTA
4. H2/H3 结构是否像真实买家指南
5. 是否至少有 3 个品牌提及
6. 是否至少有 3 个内部链接

### Step 3：决定是否直接进发布

符合下面条件才进发布：

1. 关键词没跑偏
2. 字数足够
3. 内链不为 0
4. FAQ 存在
5. CTA 明确

如果不符合：

1. 先在 ME 里重新生成一次
2. 仍不行再走人工微调

---

## 3. 发布 SOP

### 路径 A：理想状态（推荐）

适用条件：

- WordPress 已连接
- Yoast probe 通过
- 草稿可正常推送

流程：

1. 在博客详情页点击 `发布到网站`
2. 先执行 `Create Draft`
3. 打开 `Preview URL`
4. 检查：
   - 标题显示正常
   - 正文排版正常
   - 内部链接能点
   - 图片正常
   - 没有明显重复标题块
5. 确认无误后点击 `Publish`
6. 若返回 `published_url`，立刻点 `请求 Google 收录`

### 路径 B：半自动 fallback

适用条件：

- WordPress 能连，但 Yoast probe 未通过

流程：

1. 仍然在 ME 内 `Create Draft`
2. 在 WP 后台打开草稿
3. 手动补：
   - Focus keyphrase
   - SEO title
   - Meta description
4. 预览
5. 发布
6. 回到 GSC 提交收录

### 路径 C：纯手动 fallback

适用条件：

- WordPress Draft 推送失败
- 主机安全策略拦 API

流程：

1. 在 ME 里复制文章 HTML
2. 到 WP Code Editor 新建 Post
3. 手动配置 Yoast
4. 发布
5. GSC 提交收录

---

## 4. 发布后必做

1. 记录最终 URL
2. 记录目标关键词
3. 记录发布时间
4. 记录是否：
   - 自动写入 Yoast
   - 自动收录请求成功
5. 48-72 小时后复查：
   - 是否被收录
   - Search Console impressions 是否开始出现

---

## 5. 质量红线

以下情况不要发布：

1. 主关键词缺失
2. 没有内部链接
3. 标题与文章意图不一致
4. 品牌名提及过少
5. CTA 太弱
6. 发布页看起来像产品堆砌而不是买家指南

---

## 6. Oztop 的默认 SEO 规则

### 内容策略

1. 优先打 `SPC / Hybrid Flooring` 场景词
2. Brisbane 优先，Logan 第二，Gold Coast 后置
3. 每篇都要把流量导向产品页或 Book Free Measure

### 站内链接默认目标

1. `SPC / hybrid flooring`
   - `/product-category/flooring/spc-wpc-hybrid-flooring/`
2. `Engineered timber`
   - `/product-category/flooring/engineered-timber-flooring/`
3. `Vinyl flooring`
   - `/product-category/flooring/vinyl-flooring/`
4. `Tiles`
   - `/product-category/tiles/`

### CTA 默认写法

优先统一成：

- `Book Free Measure`
- `Talk to Oztop`
- `Get advice on the right flooring for your Brisbane home`

---

## 7. 今天执行时的推荐节奏

1. 先确认 WordPress 连接正常
2. 再确认 Yoast probe 是否通过
3. 在 ME 里生成今天这篇文章
4. 先走 Draft，不直接 Publish
5. 预览无误再发
6. 发完立刻请求 Google 收录

---

## 8. 今天不做的事

1. 不顺手修全站 taxonomy
2. 不顺手改首页
3. 不顺手改分类页模板
4. 不顺手补 20+ 篇旧文章的 Yoast

原则：今天只把一篇内容闭环跑通。
