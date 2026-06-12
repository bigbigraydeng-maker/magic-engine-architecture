# 子牙 #2 · ME keyword-relevance Bug 1 修复 — 启动咒语

> **PM 操作**：另开 1 个 Claude Code 窗口（在 ME 主仓 root，**不在** pensive-grothendieck-10aef6 worktree）
> **预估工时**：2-3 小时（含子牙复审 + 魏征 review）
> **影响范围**：所有客户 ME 后台 SEO Intelligence "竞品对比 + 关键词缺口" 卡片
> **目标 PR title**：`fix(seo-intelligence): keyword-relevance filter should respect client-level excluded topics`
> **触发事故**：Oztop v2 keyword gap 跑出 100 个 gap 词全部是 shutters/blinds/windows，但 Oztop 不卖

---

## 背景 + 现象

2026-06-11 PM 在 ME 后台跑 Oztop SEO Intelligence keyword gap（competitor 已重配为 carpetcall/carpetcourt/theflooringguys/floorworld/beaumont-tiles），结果 gap 100 词全部是：

```
shutters plantation blinds  27.1K
shutter windows             27.1K
shuttered windows           27.1K
shutter plantation blinds   27.1K
... (同主题 100 个)
```

**但 Oztop master_brief 明确：不卖 shutters / curtains / blinds**（参见 memory: feedback_no_business_fabrication.md "Oztop shutters 事故"）

## 根因（诸葛亮已诊断）

文件：`src/lib/seo-intelligence/keyword-relevance.ts`

```js
const BUILDING_SUPPLIES_TERMS = [
  'floor', 'flooring', 'timber', ...
  'blinds', 'blind', 'curtain', 'curtains', 'shutter', 'shutters',  // ← 问题
  ...
]
```

当 `buildBusinessKeywordTerms` 检测到客户 hint 包含 floor/flooring/oztop 等 → 自动把 BUILDING_SUPPLIES_TERMS 全套加入业务相关词表。**导致 shutters/blinds/curtains 也被认为 business-relevant，过滤不掉**。

这是平台级"建材通用词表"设计，对 Carpet Call 这类卖 shutters 的客户没问题。但对 Oztop 这类**子细分类别专业户**就误命中。

## 修复方向（子牙拍架构 + 魏征 review）

### 方向 A · 客户级 excluded_topics 字段（推荐）

加 `master_briefs.excluded_topics: text[]`（或 `clients.excluded_topics`，PM 拍板）。

```js
// 在 isBusinessRelevantKeyword 函数末尾加：
if (excludedTopics.some(topic => normalized.includes(topic.toLowerCase()))) {
  return false
}
return businessTerms.some(term => normalized.includes(term))
```

Oztop 立刻配置：
```sql
UPDATE master_briefs
SET excluded_topics = ARRAY['shutter', 'blind', 'curtain', 'window', 'plantation']
WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
```

⚠️ 排除项**用单数词根 substring 匹配**（`shutter` 命中 `shutters` / `plantation shutters` / `shuttered`）

### 方向 B · 移除 shutter/blind/curtain 从 BUILDING_SUPPLIES_TERMS

简单粗暴。但影响其他客户（Carpet Call 这类卖 shutters 的客户会被过滤掉自己业务相关词）。

⚠️ **不推荐** — 影响范围未知

### 方向 C · BUILDING_SUPPLIES_TERMS 拆子类（重设计）

```js
const FLOORING_TERMS = ['floor', 'flooring', ...]
const TILES_TERMS = ['tile', 'tiles', ...]
const CARPET_TERMS = ['carpet', 'rug', ...]
const BATHWARE_TERMS = ['bathware', 'tapware', ...]
const WINDOW_TREATMENT_TERMS = ['blind', 'shutter', 'curtain', ...]
```

按 `master_briefs.content_pillars` 推断客户子类别 → 只加对应词表。

工程量大，推迟。

### 方向 D · 用 LLM 判 relevant（成本高）

跳过。

---

## 推荐方案 = 方向 A

启动咒语用方向 A。Oztop 立刻可用，最小改动，最小影响范围。

---

## 启动咒语（PM 直接复制粘贴）

```
子牙，开 ME keyword-relevance Bug 修复 PR。

背景：2026-06-11 Oztop Building Supplies 在 ME 后台跑 keyword gap 卡片，
返回 100 个 gap 词 100% 是 shutters/blinds/windows 主题（27.1K 月搜每条）。
但 Oztop master_brief 明确不卖这一类。这是平台过滤逻辑误命中。

根因（诸葛亮诊断）：
src/lib/seo-intelligence/keyword-relevance.ts 里 BUILDING_SUPPLIES_TERMS
通用建材词表包含 shutter/shutters/blind/blinds/curtain/curtains。当客户
hint 含 floor/flooring/oztop 等 → 自动启用此通用词表 → 这些词被认为
business-relevant → 过滤逻辑漏掉它们 → 100 slot 被 shutters 顶满。

事故影响：所有"卖一部分但不卖全部建材类别"的客户都受影响（Oztop / 任何
专做 flooring 不做 window treatment 的 / 反向也成立）。

修复方案（方向 A）：

1) 加客户级 excluded_topics 字段
   - 决定放 master_briefs.excluded_topics 还是 clients.excluded_topics
     （建议 master_briefs — 跟 keyword_seeds 同层）
   - 类型 text[]，单数词根（避免 plural 漏匹配）
   - migration 需 PM 拍板才 apply（DAPE 硬约束 #1）

2) 改 isBusinessRelevantKeyword 函数签名
   - 加可选 excludedTopics 参数（向后兼容）
   - 排除逻辑放在 business-relevant 检查 **之前**
   - substring 匹配（小写）

3) 改 competitors-gap route
   - 读 master_briefs.excluded_topics（或 clients.excluded_topics）
   - 传给 isBusinessRelevantKeyword
   - 保留向后兼容（无配置时跟当前一致）

4) Oztop 测试数据
   - SQL 配置 Oztop excluded_topics =
     ['shutter', 'blind', 'curtain', 'window treatment', 'plantation']
   - 重跑 ME 后台 → gap 词应该不再是 shutters/blinds 类
   - 期望真实词：preference flooring / nfd / kdk bathroom / lappato finish
     / karndean flooring / clever choice flooring 等

5) 单测覆盖
   - Oztop 真实样本：shutters plantation blinds → non-relevant（excluded）
   - Oztop 真实样本：preference flooring → relevant
   - Oztop 真实样本：karndean flooring → relevant
   - 反例：无 excluded_topics 配置时行为不变（无回归）
   - 反例：excluded_topics ['x'] 但 keyword 不含 'x' → 仍走原逻辑

6) ROADMAP.md 登记新 Phase 子任务
   - grep diff 防误删别 Phase（参见 memory: feedback_roadmap_diff_guard.md）
   - 0 删除行

7) 复用 PR #454 模式：
   - 不污染通用函数（新写 wrapper 或可选参数 backward-compat）
   - 走子牙架构复审 + 魏征代码挑刺
   - draft 状态，等 PM mark ready

强约束（CLAUDE.md）：
- migration 必 PM 拍板才 apply（DAPE 硬约束 #1）
- 加 enum/字段必同步前端 type
- 0 删除 ROADMAP 行
- service-role RLS 不涉及（不动现有表 policy）

完成证据：
1) PR diff < 10 文件
2) 单测 ≥ 8 个新 case 全过
3) npm run build 通过
4) Oztop SQL 配置后重跑 ME 后台 keyword gap 真实截图：
   gap 词应该出现 preference flooring / nfd / kdk bathroom / lappato finish
   等真实 Oztop 业务方向词
5) Carpet Call 类客户的 keyword gap 不受影响（向后兼容验证）

走完开 PR 等 PM merge，不要自己 merge。
```

---

## 子牙完工后 PM 验证清单

子牙跑完会给你：
1. PR 链接（独立的，跟 PR #454 同样模式）
2. 改了哪几个文件
3. Oztop SQL 配置 excluded_topics 后 ME 后台 keyword gap 真实截图
4. 单测输出
5. migration SQL（PM 拍板才 apply）

PM 验证：
- [ ] PR diff 全部跟"keyword-relevance 客户级排除"主题相关
- [ ] migration 文件审过（如果有）
- [ ] Oztop 测试截图里 gap 词出现 preference flooring / nfd / kdk bathroom 等真实业务词
- [ ] Carpet Call / CTS 等其他客户的 keyword gap 不受影响
- [ ] PM apply migration（如有）
- [ ] PM merge PR
- [ ] 24h 后跑 ME 后台 Oztop keyword gap 截图给诸葛亮（task #28）

---

## 不要做的事

❌ 不要让子牙顺手修别的 bug（控制 PR 范围）
❌ 不要在同 PR 里改 BUILDING_SUPPLIES_TERMS 主体（影响范围大，留下一轮）
❌ 不要动 PR #454 已 merge 的 isBrandedKeywordWithAliases（不相关）
❌ 不要 force push / 跳过 hook（CLAUDE.md 强约束）

---

**PM 启动后**：
- 新窗口跑起来后 → 你回本窗口告诉我子牙状态，我这边并行做 CTS Conversion + Ads checklist
- 子牙 PR 出来 → 你 review 后 merge → SQL apply Oztop excluded_topics → 跑 v2 截图给我
- 我接着补 02-google-ads-plan.md v3 真实数据

---

## Bug 2 + Bug 3 怎么办（不在本 PR 里）

| Bug | 描述 | 处理 |
|---|---|---|
| 2 | 竞品月流量数字太小（11/29/34）— 其实是"共同词流量 ETV"，UI 标签命名问题 | 改 UI label + 加 tooltip，独立小 PR，**不阻塞 Ads 上线** |
| 3 | gap 词重复严重（shutters 同主题 100 个词刷屏）— DataForSEO 没去重 | 加主题聚类去重逻辑，独立 PR，**不阻塞 Ads 上线**（Bug 1 修了之后 shutters 全去掉 = Bug 3 不再明显）|

**优先级**：Bug 1 (本 PR) → Bug 3 (排期 P2) → Bug 2 (排期 P3)
