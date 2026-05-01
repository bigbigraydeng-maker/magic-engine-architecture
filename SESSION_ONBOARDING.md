# Magic Engine — 会话启动指南

> 每次新会话开始前，务必先读这个文档（5-10分钟）

---

## 1. 项目核心身份

**Magic Engine**（代码库 `crazycontent`）= Magic Lab 2026 年旗舰产品，承载两个角色：
- **直接收入**：年度陪跑服务（5–15万/客户/年）
- **Magic Lab Academy 的实战载体**：所有培训SOP从这里沉淀

### 三大核心能力（不偏离这三个）
```
SEO 内容引擎     →  搜索引擎可见度（已成熟）
GEO 优化层       →  AI 推荐可见度（2026 Q2 核心差异化）⭐
社媒内容矩阵     →  全平台内容生产（已成熟）
```

---

## 2. 当前进度（截至 2026-05-01）

```
✅ Phase 1-6      社媒内容矩阵（完成）
✅ Phase 7        AI Tracker + GEO Composer + 双信号博客 + 月报（完成）
✅ Phase 8.6-8.11 DataForSEO 五大模块（外链、排名、本地、市场基准、成本追踪）
✅ Phase 8.C.1    月报聚合器（完成）
📋 Phase 8.D      DNZ诊断策略层（下一步核心）→ P8.0采集 → P8.1分析 → P8.2执行 → P8.3接入向导
📋 Phase 9        报告化 + 客户Portal
📋 Phase 10       多语言 + 学院沉淀
```

**最新里程碑**：2026-05-01 完成 Phase 8.C.1 月报，6 大数据源聚合。下一步开发 Phase 8.D（DNZ诊断策略层）。

---

## 3. 第三方服务 ↔ 对外封装名映射 ⭐（必读）

**原则**：代码和开发文档内部可用真实名，UI/客户报告必须用对外名。

| 真实服务 | 代码内部代号 | UI/客户看到的名字 |
|---------|-----------|------------------|
| OpenAI GPT-4o-mini | `openai` | **Content Engine** |
| Anthropic Claude Sonnet | `claude` | **Strategy Engine** |
| WaveSpeed Flux-dev | `wavespeed` | **Visual Studio** |
| SEMrush | `semrush` | **Keyword Intelligence** |
| **DataForSEO** | `dataforseo` | **Link Intelligence / SERP Intelligence / Local Visibility / Market Baseline** |
| Airtable | `airtable` | **Content Workspace** |
| Publer | `publer` | **Publishing Hub** |
| HeyGen | `heygen` | **Avatar Studio** |

**实施要点**：
- ❌ UI 文案中禁止出现真实名："WaveSpeed"、"DataForSEO" 等
- ✅ 按钮文案、错误提示、报告只用对外名
- ✅ 代码、内部日志、技术文档可用真实名

---

## 4. 强制任务跟踪机制

> 防止任务丢失的三层体系

```
ROADMAP.md（持久层，项目本体）
   ↓ 所有任务源头，按 Phase 分组，验收标准清晰
TodoWrite（会话层）
   ↓ 当前对话的细粒度执行追踪
Git Commit（事实层）
   ↓ 每个完整任务一个 commit，message 包含任务 ID
```

### 任务 ID 格式
`P<Phase>.<Section>.<Task>` 例如：
- `P7.1.2` = Phase 7 Section 1 Task 2
- `P8.0.3` = Phase 8 Section 0 Task 3

### 工作流强制规则
1. **新任务进入** → 先在 ROADMAP.md 登记（ID + 验收标准）
2. **开始执行** → TodoWrite 标记 `in_progress`
3. **任务完成** → ROADMAP.md checkbox 改 `[x]`，Git commit 包含任务 ID
4. **会话结束** → TodoWrite 未完成项必须回写 ROADMAP.md（禁止只在 TodoWrite）

### 如何回答"现在做到哪了"
```
当前 Phase: 8.D DNZ诊断策略层
已完成：P8.0.1, P8.0.2（数据库 + Jina 集成）
进行中：P8.0.3（CTS Tours DNZ 采集验证）
下一项：P8.1（三维策略分析）
技术债：TD.7（聚合器重试机制）、TD.15（测试覆盖）
```

---

## 5. 地域性约定（AU/NZ 主战场）

**所有功能必须默认 AU/NZ 上下文**：

- **AI Tracker 问句**：带地域标签 → "in New Zealand" / "for Australian"
- **GEO Composer 指令**：含市场信号 → `Audience: New Zealand travelers`
- **关键词数据库**：默认 `au`（客户级可覆盖 `nz`）
- **内容生成 Prompt**：显式声明市场 → "This is a New Zealand business…"
- **英语拼写**：AU/NZ 拼写（travellers / specialisation），非美式
- **时区**：NZST / AEST，非 UTC

**为什么**：AU/NZ 市场是 2026 H1 的核心目标（高价值、竞争小、法律友好）。

---

## 6. 核心文档导航

| 文档 | 适合人群 | 关键章节 |
|------|---------|---------|
| [ROADMAP.md](./ROADMAP.md) | 所有开发者 | §2（任务跟踪）、§3（Phase 7）、§5.8（Phase 8） |
| [CLAUDE.md](./CLAUDE.md) | AI 助手专用 | §三（第三方服务映射）、§八（任务跟踪）、§十二（AU/NZ） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构讨论 | §3（数据库）、§7（外部服务）、§11-12（GEO/Tracker） |
| [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md) | 产品理解 | 商业模式、能力矩阵、竞争优势 |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | 快速查询 | 命令、表结构、API 端点 |

---

## 7. 开发前 Checklist

- [ ] 已读本文件（SESSION_ONBOARDING.md）
- [ ] 已读 [ROADMAP.md](./ROADMAP.md) 当前 Phase（了解任务进度）
- [ ] 已读 [CLAUDE.md §三](./CLAUDE.md)（第三方服务封装规范）
- [ ] 确认目标任务在 ROADMAP.md 中有 ID
- [ ] 确认 UI 文案不含真实第三方名
- [ ] 如涉及关键词数据，确认默认 `au` 或客户级 `nz`
- [ ] 如涉及 AI 生成，确认 prompt 有地域标签

---

## 8. 常见陷阱 & 禁止事项

### ❌ 禁止

| 禁止行为 | 为什么 | 正确做法 |
|---------|--------|---------|
| UI 文案出现"OpenAI"、"DataForSEO" | 违反封装规范 | 用对外名：Content Engine / Link Intelligence |
| 新任务直接开发，不登记 ROADMAP | 任务会丢失 | 先在 ROADMAP.md 新增任务 ID + 验收标准 |
| 只在 TodoWrite 标记完成 | TodoWrite 会话结束就消失 | 同时更新 ROADMAP.md checkbox |
| 生成内容忽视 AU/NZ 拼写 | 客户感受不专业 | 检查 British/NZ 英语（honour, travelling） |
| Commit message 不含任务 ID | 无法追踪代码与任务的关系 | `feat: xxx [P8.0.3]` |

### ✅ 必须

| 必做项 | 意义 |
|--------|------|
| 每个 Git commit 包含任务 ID | 代码与任务可溯 |
| DataForSEO 相关模块用对外名（Link Intelligence等） | 保持品牌一致性 |
| 月报数据用 `SERVICE_DISPLAY_MAP` 映射 | 防止暴露内部名 |
| Brand Brief / 内容生成显式声明 AU/NZ 上下文 | AI 输出贴合市场 |

---

## 9. 技术栈速查

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 14 App Router + Tailwind CSS |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini（内容）+ Anthropic Claude（策略） |
| AI 图片 | Atlas Cloud (WaveSpeed Flux-dev) |
| AI 视频 | Atlas Cloud (Seedance 2.0) |
| 关键词数据 | SEMrush API + DataForSEO API |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API |
| 网页抓取 | Jina.ai Reader |
| 部署 | Render（自动部署 master）|

---

## 10. 快速问答

**Q: 我要开发新功能，第一步是什么？**  
A: 打开 ROADMAP.md，找到对应 Phase，检查是否有任务 ID。没有则先新增任务（含验收标准），再开发。

**Q: 我看到"DataForSEO"这个词怎么办？**  
A: 代码内部可以用，UI 和客户文档必须替换为对外名：Link Intelligence / SERP Intelligence / Local Visibility / Market Baseline。

**Q: 内容生成时，怎么保证不出错（拼写、市场信号）？**  
A: Prompt 里显式写 `"This content is for New Zealand audience. Use NZ English spelling (e.g., honours, travelling)."` 

**Q: 应该使用哪个 Claude 模型？**  
A: Strategy Engine（Anthropic Claude Sonnet），用于 Brief 生成、GEO Composer、策略分析。Content Engine 用 OpenAI GPT-4o-mini。

**Q: 如果发现任务丢失了怎么办？**  
A: 检查三层：① ROADMAP.md 是否有记录（源头）② TodoWrite 是否标记（会话层）③ 最近的 commit 是否有任务 ID（事实层）。优先级：ROADMAP > 事实。

**Q: 月报包括哪 6 个数据源？**  
A: ① AI Visibility Tracker（Phase 7）② Link Intelligence ③ SERP Intelligence ④ Local Visibility ⑤ Market Baseline ⑥ Billing Monitor（都是 Phase 8）

---

## 11. Phase 8.D 核心概况（当前重点）

> 下一个月的主要工作（如无新需求）

### 目标
从客户网站现状 → 三维策略分析（AI弱项 × SEO缺口 × 现有内容） → 驱动内容执行

### 四个子任务
1. **P8.0 Domain Snapshot（DNZ）采集**  
   - 抓取客户网站 ≥30 页面 + 分类（page_type、topics、word_count）  
   - 方案：Jina.ai Reader + 本地分类器

2. **P8.1 三维策略分析**  
   - 交叉 AI弱项（P7.1）× SEMrush 关键词缺口 × 现有页面薄弱点  
   - 输出：策略列表（按优先级评分）

3. **P8.2 策略驱动执行**  
   - 从策略面板触发内容生成（博客新建 / 页面升级 / 社媒联动）  
   - 消除盲目生成问题

4. **P8.3 客户接入向导**  
   - 5 分钟完成新客户建档 + DNZ 采集  
   - 嵌入自动化流程

### 关键验收标准
- CTS Tours 客户跑通完整流程（采集 → 分析 → 生成 → 验证）
- ≥10 条策略建议，每条有 action_type / priority_score / rationale

---

## 12. 技术债优先级（Phase 8.C.1 引入）

| ID | 内容 | 优先级 | 截止 |
|----|------|--------|------|
| **TD.7** | 聚合器重试机制（exponential backoff） | 🔴 HIGH | Phase 9 前 |
| **TD.8** | 聚合器事务一致性 | 🔴 HIGH | Phase 8.C.1 后期 |
| **TD.15** | 聚合器测试覆盖（目标 80%+） | 🔴 HIGH | Phase 8.C.1 前 |
| **TD.9** | 聚合器性能优化（N+1） | 🟡 MEDIUM | 50+ 客户前 |
| **TD.11** | API 速率限制 | 🟡 MEDIUM | Phase 8.C.2 前 |
| **TD.6** | UI 文案真实名暴露 | 🟡 MEDIUM | 随时修 |
| 其他（12项） | 见 ROADMAP.md §6 | 🟢 LOW | Phase 9+ |

---

## 13. 如何请求帮助

如果卡住或需要澄清，检查清单：

1. **任务不清** → 查 ROADMAP.md 任务 ID 的验收标准
2. **API 调用** → 查 QUICK_REFERENCE.md 或 ARCHITECTURE.md
3. **第三方集成** → 查 CLAUDE.md §九（环境变量）
4. **数据结构** → 查 ARCHITECTURE.md §3（Supabase 表）
5. **架构决策** → 查 ARCHITECTURE.md 对应章节 + ROADMAP.md §1（战略路线图）

---

## 14. 常用命令速查

```bash
# 开发
npm run dev              # 启动 :3001
npm run build            # 生产构建
npm test                 # 单元测试

# 数据库
# 本地 Supabase（如已配置）
supabase start
supabase migration up

# Git
git add <files>
git commit -m "feat: description [P8.0.1]"
git push origin master   # 自动触发 Render 部署
```

---

## 15. 快速参考链接

- **实时任务** → [ROADMAP.md](./ROADMAP.md)
- **技术细节** → [ARCHITECTURE.md](./ARCHITECTURE.md)
- **AI 工作指南** → [CLAUDE.md](./CLAUDE.md)
- **产品愿景** → [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)
- **API 端点** → [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)

---

**最后更新**：2026-05-02  
**当前 Phase**：8.D DNZ诊断策略层（规划中）  
**下一个关键里程碑**：P8.0 DNZ采集模块开发 + CTS Tours 端到端验证
