# ME 旅游版 · 出发团库存 + 员工看板 + Agent 门户 —— 设计方案 v2

**状态**：设计稿 v2（已吸收子牙 / 魏征 2 审）。**未建表、未写 migration、未实现任何代码。**
**Codex round-2 复审新增未解决事项**：本方案与 `ME_PRODUCT_DEFINITION.md` §3.2/§3.3 的冻结产品边界存在冲突，见 §0.5 第 3 条 —— **PM 未就该条书面表态前，①②③不许进入 migration 实施。**
**风险级**：A（数据库 schema / migration；④ 另触发鉴权 + 并发 + 资金记录）
**上游需求单**：[`2026-09-08-cts-tour-inventory-and-agent-portal-spec.md`](./2026-09-08-cts-tour-inventory-and-agent-portal-spec.md)
**Repository Fact Gate**：`git fetch origin` 已跑（2026-09-08），`origin/main` = `1ed91a314d836ad3d524a152255f4dd47f39e1f4`

> **v1 → v2 的定性变化**：PM 2026-09-08 明确「**这是 ME 旅游行业的通用需求**」。
> v1 把它当成「CTS 要的东西，顺便别写死」；v2 把它当成 **ME 旅游版的地基**，CTS 是第一个使用者而不是唯一使用者。
> 这条改变了三个具体设计（见 §0.6），不只是措辞。

---

## 0. 平台层级判定（me-platform-tier-gate · Full Report · v2）

### 0.1 被判定对象
「出发团库存（可售单元 + 容量 + 座位占用 + 防超卖 + 代理下单）」属平台层 Capability、行业 Playbook 还是客户配置。

### 0.2 结论

**L2 · ME 旅游版 Playbook（PM 2026-09-08 拍板确认为旅游行业通用需求）。**

拆解后各归各层：

| 块 | 层级 | 落点 |
|---|---|---|
| 出发团台账的领域模型（product → departure → seats → 订位单 → 直招/代理两来源） | **L2 · ME 旅游版** | 本方案的三张表；任何旅游客户共用 |
| CTS 的具体 tour / 日期 / 价格 / 容量 / 报名人 / 代理名单 | **L4 客户数据** | 数据行 + 客户配置，不进 shared runtime |
| chinatravel 仓 `tours.ts` 的读取适配器 | **L3 Connector** | **可插拔且可缺席**——第二个旅游客户没有这个仓也要能用（红线 3 显式排除 L3，不占候选名额） |
| 「容量型资源的原子占位」（先锁行 → 重算 → 超了拒绝 → 过期靠算不靠任务） | **L1 候选 · 默认降级不直建** | 子牙提出；跨行业成立（电商 SKU / 地产带看时段 / 课程席位 / 外呼并发数），登记候选 |
| 「可售状态作为营销闸门」（售罄 → 停投广告 / 停群发 / 停排内容） | **L1 候选 · 默认降级不直建** | 登记候选，等第 2 个行业事实复制 |
| 座位扣减 / 代理下单 / 佣金结算作为**完整订位系统** | **不是 ME 能力** | **PM 拍板项**，见 §0.5 |

### 0.3 归属
- ME 6 支柱之一：**都不是**（库存不是 SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）
- 平台基础设施：**都不是**
- → 不是 L1。**禁止包装成「库存智能层」/「Inventory Intelligence」**——那正是 2026-08-27 HBay「KOL 智能层」事故的同一个动作（红线 1）。
- `me-travel`（ME 旅游版）已在 [`docs/registry/product-versions.md`](../registry/product-versions.md) 在册（状态「规划中」），L2 绑定合法，**不需要新增版本**。

### 0.4 换客户 / 换行业测试（语义级）

**换行业测试 ✗**（这是它不能升 L1 的原因）
- **反例 · Oztop（建材 / 展厅）**：没有「座位」。可售单元是库存件数或展厅预约时段，容量恒为 1，无定金/尾款两段付款，无代理分销层。
- **反例 · Magic Picks（电商 DTC）**：库存是 SKU 件数，无出发日期，不绑人头，退款即时回补。
- **反例 · Roman（地产中介）**：房源是唯一件（卖掉即下架），open home 是时段不是容量，付款走律师信托账户。

**换旅游客户测试 ✓**（这是它够得上 L2 的原因，也是 v2 新增的判据）
问句：**换成第二家旅游运营商（悉尼的入境游批发商 / 奥克兰的邮轮代理），本方案的表和代码要不要改？**
- 产品 → 出发团 → 每团有限座位 → 定金锁位 + 尾款结清 → 直客与同业代理两条来源：**全部成立**。
- 需要按客户变的只有：币种（AUD / NZD）、阶段档位名、定金比例、代理佣金率、内容数据源。**这些必须全部是配置或数据，不能是代码分支。**
- **验收判据（写进 §6）**：新建一个虚构旅游客户，只插数据 + 改配置、**不改一行代码**，能跑通「建团 → 设容量 → 录报名 → 看板显示剩余」。做不到就说明有客户语义漏进了 shared runtime。

### 0.5 PM 拍板项（3 条，本方案不替 PM 决定；第 3 条是 Codex round-2 复审新增的边界冲突，不解决不能进 §6）
1. **ME 旅游版要不要做到「完整订位系统」这一步？** 记台账（本方案）和做订位系统（代理自助下单 + 座位实时扣减）是两个量级。②③ 是台账，④ 是订位系统的入口。
2. **ME 要不要进代理佣金的资金链路？** 本方案 v1/v2 一律**只记账不动钱**（记佣金率、算应付额，实际付款线下走）。
3. **本方案自建的四张表，撞上了 `ME_PRODUCT_DEFINITION.md` 的冻结产品边界，PM 必须显式表态**：
   [`docs/strategy/ME_PRODUCT_DEFINITION.md`](../strategy/ME_PRODUCT_DEFINITION.md) §3.2「ME 不直接负责」明文把「旅游库存、正式报价、出票和预订后台」列为 ME 不自建的经营/交易系统，要求这些系统继续作为 Source of Truth、ME 只通过 Connector 读取必要事实；§3.3「最小保存原则」只允许保存**外部对象的稳定引用** / 必要营销上下文 / 授权快照与证据 / 动作与 Outcome，明令「不应因为『以后也许有用』而复制外部系统的完整…库存…订单数据」。
   本方案①②的 `tour_products` / `tour_departures` / `tour_bookings` / `travel_agents` 四张表，是 ME 自己承载产品、容量、座位占用与订位单的**完整台账**——这正是 §3.2 排除的「预订后台」形状，不是「读取外部事实的引用」。PM 2026-09-08「这是旅游行业通用需求」这句话，定的是**层级归属**（L2 而不是 CTS 特例），**没有**显式修改这条产品边界，见 §0.1-§0.2 的判定范围本身就没有覆盖到这一条。
   §2.2 已实地核对 chinatravel 仓（`tours.ts`）：那是内容站，没有座位 / 容量 / 订位数据，**当前不存在**一个已有的外部订位系统可以当 Connector 的源——这是本方案选择自建台账的真实原因，但这个技术现实不能替 PM 做「ME 要不要越过 §3.2 这条边界」的产品决定。
   PM 必须二选一才能放行 §6 实施：
   - **(a) 显式例外**：确认「CTS 目前没有独立的订位后台，ME 台账本身就是这次的 Source of Truth」，接受本方案作为 §3.2/§3.3 的一次显式例外，并把这句话连同范围（仅 CTS，还是旅游行业默认）记进 [`docs/DECISIONS.md`](../DECISIONS.md)；或
   - **(b) 维持边界**：要求先接入/搭建一个外部订位系统作为 Source of Truth，本方案降级为读取该系统的 Connector（②③需按此方向重写，④结论不变）。
   **在 PM 对这一条给出书面答案之前，①②③不得进入 migration 实施**；这条独立于第 1、2 条，即便 PM 已经回答了 1、2 也不构成对第 3 条的默认同意。

### 0.6 PM 定性为「行业通用」后，设计实际改了什么（不是措辞，是三处结构）

| # | v1（当 CTS 的活） | v2（当旅游版地基） |
|---|---|---|
| 1 | 库存靠 chinatravel 仓同步进来，手工录入是补丁 | **手工建团 / 设容量是主路径**，chinatravel 同步降为可选适配器。第二个旅游客户没有那个仓，主路径必须不依赖它 |
| 2 | `currency` 被 2 审判为过度设计，建议删 | **保留**。ME 旅游版第一个 AU 客户就要 AUD，删了等于给行业版埋雷 |
| 3 | 订位单状态 → CRM 阶段的映射可以写在代码里 | **必须落客户配置**（`client_pipeline_stages` / `clients.leads_config`）。阶段档位本来就是按客户可配的，写死 = 客户语义进 shared runtime（红线 2） |

### 0.7 红线检查
- 红线 1 禁包装升级：✓
- 红线 2 禁客户/行业事实进 shared runtime：✓（新增 §0.6-3 的映射外置；`src/lib` 里不出现 `cts` / `c0000000-...` / 具体团名）
- 红线 3 禁直建 L1：✓（判 L2 实现 + 2 条 L1 候选登记）
- 红线 4 换客户测试语义级：✓（旅游内 ✓ / 跨行业 ✗，两侧都列了具体反例）
- 红线 5 换行业测试语义级：✓
- 红线 6 若 L1 走五道 Build Gate：不适用
- 红线 7 L2 只装行业级：✓（旅游行业形状进表结构，CTS 具体事实全在数据行与配置）

### 0.8 结论
- **判定层级：L2 · ME 旅游版**（+ L4 客户数据 + L3 可选适配器 + 2 条 L1 候选）
- 改口话术：不说「给 CTS 做个库存表」，说「**ME 旅游版的出发团台账**：旅游客户共用的可售容量与报名占位模型，把『还能不能卖』这条事实喂给已有的广告 / 外发 / 内容闸门」
- 候选登记：**待 PM 一句「记」**（3 条，见 §7）

---

## 1. 分期

| 期 | 内容 | 风险级 | 本方案深度 |
|---|---|---|---|
| ① | 出发团库存（`tour_products` / `tour_departures`）+ 容量录入 UI | A | 可实施 |
| ② | `tour_bookings` 订位台账（原 `contact_deals`，改名理由见 §3.0）+ `travel_agents` 最小身份表（见 §2.8，`tour_bookings.agent_id` 的外键目标，②必须一起建） | A | 可实施 |
| ③ | 员工看板 UI | A | 可实施 |
| ④ | Agent 门户 | A | **拆出去单独出方案**（见 §5） |

**分期硬约束**：①②③ 合并上线并跑满一个真实报名周期后再动 ④。

---

## 2. ①出发团库存

### 2.1 两张表的理由
PM 的问题本身是两个维度：「有多少个 tour 在卖」= 产品；「每个 tour 招募情况」= 出发团。一个产品多个出发团，出发团才是可售单元。

### 2.2 源数据的真实情况（v1 三处写错，已实地核对更正）

实测 `/Users/raydeng/Projects/chinatravel/src/lib/data/tours.ts`：

| 事实 | 数字 | 对设计的影响 |
|---|---|---|
| tour 条目 | **32 个**（31 个 `isActive:true`） | 需求单写的「7 个产品」是错的 |
| 带 `departureDates` 的 | **14 个**，共约 **25 个出发团** | 需求单写的「8 个出发团」是错的；18 个产品没有出发日期，同步只能建产品不建团 |
| 带 `maxGroupSize` 的 | **只有 1 个**（`golden-china` = 12） | **容量没有数据源**，见 §2.4 |
| 出发城市字段 | **不存在**（grep `departureCity` / `departsFrom` 零命中） | `departure_code` 不能包含出发城市，见 §2.5 |
| `id` 唯一性 | **不唯一**（`tour-jp-sig-1` 用了两次：2401 行 / 2729 行） | 不能拿 `id` 当同步键 |
| `slug` 唯一性 | **不唯一**（`highlights` 同时属于 japan 和 vietnam） | 不能拿 `slug` 单独当同步键 → 必须 `(destination, slug)` |
| `departureDates` 是否都是字面量 | **否**，749 / 962 两行是 `[...OCTOBER_2026_DISCOVERY_BY_SLUG[...]]` 计算展开 | 文本解析会静默拿到空，必须靠 import 模块而不是正则 |
| `departurePricing` | 全文件只有 3 处 | 绝大多数出发团没有价格 → 价格必须可空 + UI 显示「未标价」 |

**v1 的错误更正**：v1 §2.2 用「圣诞团两个出发城市变体同一天」论证 `slug + date` 不够用。实测这两个变体是**两个不同的产品**（`china-icons-collection` $7,188 / `china-icons-collection-christchurch` $6,188），slug 不同。**结论没变（不用 slug+date 当主键），但理由是错的**——错的理由会让实现者去写一段解析产品名取城市的代码，那才是真会出错的地方。

### 2.3 表结构

```sql
-- tour_products —— 在卖的产品
CREATE TABLE tour_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 外部内容源的标识。手工建的团为空 —— 手工是主路径，不是补丁。
  source_kind   TEXT,                       -- 'chinatravel_repo' | NULL(手工)
  source_ref    TEXT,                       -- 该源内的稳定标识，chinatravel = 'china/silk-road'
  title         TEXT NOT NULL,
  destination   TEXT,
  status        TEXT NOT NULL DEFAULT 'selling'
                  CHECK (status IN ('selling', 'retired')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tour_products_source_key UNIQUE (client_id, source_kind, source_ref),
  -- 复合外键的目标列：让 tour_departures 能把 (client_id, tour_product_id) 一起校验，见下方
  CONSTRAINT tour_products_client_id_unique UNIQUE (client_id, id)
);

-- tour_departures —— 可售单元
CREATE TABLE tour_departures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- 不用单列 REFERENCES tour_products(id)：那样客户 A 的 client_id 配客户 B 的
  -- tour_product_id 也能通过约束。必须用下方复合外键把两列一起钉死。
  tour_product_id   UUID NOT NULL,

  departure_date    DATE NOT NULL,
  departure_city    TEXT,                   -- 展示用，人工填，**不进任何键**
  duration_days     INTEGER CHECK (duration_days IS NULL OR duration_days > 0),

  price_amount_minor BIGINT CHECK (price_amount_minor IS NULL OR price_amount_minor > 0),
  price_currency     TEXT CHECK (price_currency IS NULL OR
                       (price_currency = upper(price_currency) AND length(price_currency) = 3)),

  -- 🔴 可空。NULL = 「容量未设定」，不是 0。见 §2.4
  seats_total       INTEGER CHECK (seats_total IS NULL OR seats_total >= 0),

  -- 'retired' = 源里已经不存在这个出发日期（§2.6 硬约束 4：标 retired，不删行）。
  -- 不能只有 open/closed/cancelled：同步遇到「产品还在但这个出发日期没了」时，
  -- 没有能落库的状态可写。
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed', 'cancelled', 'retired')),

  source_date_text  TEXT,                   -- 外部源的原文日期串，供人工对账
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 唯一性直接建在业务字段上，不再引入 departure_code（见 §2.5）
  CONSTRAINT tour_departures_natural_key
    UNIQUE (client_id, tour_product_id, departure_date),

  -- 复合外键：强制这个出发团的 client_id 与它所属产品的 client_id 一致，
  -- 否则客户 A 的 client_id 搭客户 B 的 tour_product_id 也能建团（2 审 blocker）。
  CONSTRAINT tour_departures_product_client_fk
    FOREIGN KEY (client_id, tour_product_id)
    REFERENCES tour_products (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX tour_departures_client_date_idx ON tour_departures (client_id, departure_date);
CREATE INDEX tour_departures_product_idx     ON tour_departures (tour_product_id);
```

金额一律 `*_minor BIGINT`（分/仙），跟已上线的 `me_sale_outcomes.amount_minor` 保持同一种存法。**同一个仓库不许两种钱的存法。**

### 2.4 `seats_total` —— 必须连录入 UI 一起做（2 审 blocker）

- 源数据 32 个团里**只有 1 个**有容量。前端 `TourHero.tsx:74` 那个 `?? 18` 是营销文案的默认值，**不是真容量，绝不许拿来当数据**（铁律 8：不凭空注入客户业务数据）。
- 所以 `seats_total` **可空**，`NULL` 的语义是「还没设」。
- 看板对 `NULL` 显示「**容量未设置**」+ 一个「去设置」的入口，**绝不显示 0**。显示 0 会让员工以为团满了；再叠加 §7 候选「售罄就停投广告」，就是一次自动停掉全部投放。
- **出发团详情页必须有可编辑的座位数字段 + 改动留痕**（铁律 8：FDE 要填的字段必须连 Settings UI 一起做完，绝不写「让 PM 进 Supabase Studio 直填」）。这一条进 §6 验证清单。

### 2.5 不要 `departure_code`（v1 的设计删掉）

v1 设计 `departure_code = (slug, ISO 日期, 出发城市)`。两个问题：
1. **出发城市源数据里没有**，只能解析产品名，必然出错。
2. **日期解析跟机器时区走**：实测 `new Date('13 May 2027').toISOString().slice(0,10)`，本机 `TZ=Pacific/Auckland` 得 `2027-05-12`，Render 容器 `TZ=UTC` 得 `2027-05-13`。同一个团在本机和生产会生成两个不同的键 → 生产多出一份空团，报名挂在另一份上。

v2 改法：
- 唯一性直接用 `(client_id, tour_product_id, departure_date)` 这条自然键，不再引入派生字符串。
- **禁止 `new Date(<字符串>)`**。日期解析写成显式纯函数（`'13 May 2027'` → 拆日/月名/年 → `2027-05-13`），配时区无关的单测（同一输入在 `TZ=UTC` 与 `TZ=Pacific/Auckland` 下必须相等）。

### 2.6 内容同步 —— 可选适配器，不是主路径

**定位变了**（因为 PM 定性为行业通用）：手工建团是主路径；chinatravel 同步是 CTS 这一个客户的可选加速器。

- **复用已有通道**：ME 里已经有读写 chinatravel 仓的能力——`src/lib/cms/github-client.ts` + `src/lib/cms/connection-store.ts`，`src/lib/seo-meta/cts-meta-pr.ts` 已经在解析并改写该仓 `src/lib/data/*.ts`。**不许另起一套读法**（铁律 0）。
- **已知冲突**：`cts-meta-pr` 会自动改写 `title` 字面量，而同步用 `title` 做展示。两个自动化动同一个文件，PR 里要写明谁先谁后。
- **五条硬约束**：
  1. 同步**只碰内容字段**（title / destination / 日期 / 价格）；**绝不写 `seats_total`，绝不碰任何报名数据**。
  2. 日期解析失败 → 落人工待办，不静默跳过。
  3. 「产品有 `departureDates` 但解出 0 个」→ 同样落待办（对付 749/962 两处计算展开）。
  4. 源里消失的团 → 标 `retired`，**不删行**。
  5. **改日期 = 删旧建新**：同一产品下出现「已 retired 但还挂着报名」的团 → 必须落待办说明「这个团的日期可能改了，X 个报名需要迁移」。v1 完全漏了这一类。
- **人工待办怎么落**：`src/lib/pm-todo/manual-items.ts` 是**拉取式**的（`loadManualItems` 现算，不是往表里插行）。所以要先把同步异常**持久化**（建议 `tour_sync_issues` 表或产品行上的一个 JSONB 列），再加一个 `push*Items` 函数 + 一个新的 `ManualItemKind`。只写「复用 manual-items.ts」会让实现者发现无处可插。
- **cron**：新建 `/api/cron/*` 必须**同一个 PR 内**加 `render.yaml` 条目（铁律 7），并手动 link 密钥环境变量组（漏了会每天 401 静默失败）。
- **免 Inngest 的理由要写全**：CLAUDE.md §3 要求写明**原因 + 恢复条件 + 替代 receipt 在哪**，v1 只写了原因。

### 2.7 RLS

```sql
ALTER TABLE tour_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON tour_products
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```
**必须带 `TO service_role`**（铁律 7）。

> **v1 的误报已删**：v1 §2.6 称现有 4 张 CRM 表漏 `TO service_role` 需单独报 PM。**实测生产库（`glbdnayojixmexgofbsd`）这 5 张表的策略 `roles` 全部是 `{service_role}`，RLS 均已开启**，`20260803020000_rls_lock_policies_to_service_role.sql` 早已批量收口，`scripts/db-invariants.sql` 不变量 1 还在 CI 里守着。**没有这个问题，不要报给 PM。**

### 2.8 `travel_agents` —— 最小身份表（②必须建，不是 ④ 的活）

**2 审后发现的顺序问题**：①②③ 被标为可独立实施，§3.2 `tour_bookings.agent_id` 却引用 `travel_agents(id)`，而这张表在 v1/v2 之前的草稿里一直挂在被推迟的 ④（Agent 门户）名下。按当前分期顺序建 ②的 `CREATE TABLE tour_bookings` 会直接报 `relation "travel_agents" does not exist`。

**拆法**：把「代理是谁」的身份台账拆出来，跟着②一起建；「代理怎么登录 / 门户授权」仍然留在 ④。②里员工录代理订位时，从这张表选代理或新建一条，不涉及登录。

```sql
CREATE TABLE travel_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  contact_email  TEXT,
  contact_phone  TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT travel_agents_name_unique UNIQUE (client_id, name),
  -- 复合外键的目标列：让 tour_bookings 能把 (client_id, agent_id) 一起校验，见 §3.2
  CONSTRAINT travel_agents_client_id_unique UNIQUE (client_id, id)
);

ALTER TABLE travel_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON travel_agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

④ 需要登录关联时，在这张表上加一列（例如 `portal_user_id UUID REFERENCES client_portal_users(id)`），不改这张表已有语义，也不需要重建。

---

## 3. ②订位台账

### 3.0 改名：`contact_deals` → `tour_bookings`

2026-07-28 草案叫 `contact_deals`。v2 改名，两个理由：
1. ME 里 **`deal` 这个词已经被占了**——冻结契约 `me/crm.deal.closed` 的 `deal_id` 指的是**成交**。订位单不等于成交（占位、取消都不是）。同名会让两套东西在代码和事件里混淆。
2. 这是 ME 旅游版的表，`booking` 是这个行业的通用词。

### 3.1 2026-07-28 草案能不能直接用：形状对，5 个洞

草案：`contact_id` + `tour_slug` + `departure_date` + `source_channel` + `agent_name` + `deposit_amount`/`total_amount` + 两个付款时间

| # | 洞 | 后果 | 修法 |
|---|---|---|---|
| **1** | **没有人数（pax）** | **致命。** 一家四口是一条单。按单计数得「报了 1 个」，实际占 4 个位置——「还剩几个位置」直接错 | `seats INTEGER NOT NULL CHECK (seats > 0)` |
| 2 | `tour_slug + departure_date` 当外键 | 无外键约束，团改名即断链 | `departure_id UUID REFERENCES tour_departures(id)` |
| 3 | `agent_name` 自由文本 | 建不了代理门户（无代理身份，做不到「只看自己的客人」）；同一家代理三种写法 | `agent_id UUID REFERENCES travel_agents(id)` |
| 4 | 没有单据状态 | 退订/取消无法表达，座位永远还不回来 | `status` 状态机 |
| **5** | **自带金额字段** | **跟已上线的成交账本重复建账**，见 §3.3 | 金额不自己存，引用 `me_sale_outcomes` |

### 3.2 表结构

```sql
CREATE TABLE tour_bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  departure_id    UUID NOT NULL REFERENCES tour_departures(id) ON DELETE RESTRICT,

  seats           INTEGER NOT NULL CHECK (seats > 0),

  source_channel  TEXT NOT NULL CHECK (source_channel IN ('direct', 'agent')),
  -- 不用单列 REFERENCES travel_agents(id)：那样客户 A 的 booking 能引用客户 B 的
  -- 代理，B 的代理门户就能查到 A 的订位与联系人（2 审 blocker）。必须用下方复合外键。
  agent_id        UUID,
  agent_name      TEXT,                       -- 显示快照，代理改名不影响历史单

  -- 🔴 单一状态机。占用公式必须从这里派生，不许在别处再写一份字面量。
  status          TEXT NOT NULL DEFAULT 'held'
                    CHECK (status IN ('held', 'confirmed', 'cancelled')),
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,

  -- 钱不在这张表。收款事实一律落 me_sale_outcomes（见 §3.3）。
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 代理单必须有代理身份（收紧 v1 那条形同虚设的 CHECK）
  CONSTRAINT tour_bookings_agent_requires_id
    CHECK (source_channel <> 'agent' OR agent_id IS NOT NULL),

  -- 复合外键：强制这条订位单的代理与自己同一个 client_id（2 审 blocker）。
  -- agent_id 可空时（direct 单）复合外键按 Postgres 默认 MATCH SIMPLE 不校验，符合预期。
  CONSTRAINT tour_bookings_agent_client_fk
    FOREIGN KEY (client_id, agent_id)
    REFERENCES travel_agents (client_id, id) ON DELETE RESTRICT
);

-- 同一个人在同一个团上只能有一条未取消的单（防员工录一次 + 代理再提一次的双倍占位）
CREATE UNIQUE INDEX tour_bookings_one_live_per_contact
  ON tour_bookings (departure_id, contact_id) WHERE status <> 'cancelled';

CREATE INDEX tour_bookings_departure_status_idx ON tour_bookings (departure_id, status);
CREATE INDEX tour_bookings_contact_idx          ON tour_bookings (contact_id);
CREATE INDEX tour_bookings_agent_idx            ON tour_bookings (agent_id) WHERE agent_id IS NOT NULL;
```

**跨表 client_id 一致性**：`client_id` 是冗余列。与 `travel_agents` 的一致性已经由上方 `tour_bookings_agent_client_fk` 复合外键在写入时静态钉死；但 `contacts.client_id` 和 `tour_departures.client_id` 没有对应的单列外键可以复合（`contact_id` / `departure_id` 各自已是单列 FK），这两条**必须另有触发器**保证 `client_id` 同时等于 `contacts.client_id` 与 `tour_departures.client_id`。否则在 ④ 里，代理传一个别的客户的 `departure_id` 就能跨客户写数据。参照 `contact_identities` 的做法。

### 3.3 钱去哪：**引用已上线的成交账本，不自己建一本**（2 审 blocker）

ME 里 2026-09-05 已上线 `me_sale_outcomes`（`20260905000002_conversion_writeback_v1.sql`），语义一一对应：
- `outcome_kind='purchase'` = 收到定金（PM 定义：收到定金即成交）
- `outcome_kind='balance'` = 尾款到账
- 带 `contact_id` / `amount_minor` / `currency` / `order_ref` / 人工审核闸 / 脱敏列
- 配套 `me_conversion_writebacks` 有三道防重发闸

**再建一本的后果**：同一笔定金被记两次 → 发给 Meta 两次 → **CAPI 没有删除端点，发错撤不回**。PM 2026-09-05 明令「定金算成交，坚决不能记成 2 笔」。

**v2 的接法**：
- **`tour_bookings` 本身不存定金/尾款金额或到账时间**（§3.2 已明确「钱不在这张表」），所以按钮点击这个动作本身**没有可落库的输入**——`booking.seats` / `departure` 都推不出「收了多少钱、什么时候到账」。「已收定金 / 已收尾款」不能是一次静默写库，必须先弹出一个小表单收两件事：**实收金额**（主单位，员工手输，默认带出 `tour_departures.price_amount_minor` 但可改，因为定金往往不等于全款）、**到账日期**（默认今天，可改，语义是 `me_sale_outcomes.occurred_at`——「钱到账 / 客人来问」的日期，不是行程出发日，`src/lib/conversions/intake.ts` 对未来时间和「超 7 天」各有一道校验）。
- 该表单提交后**复用既有 intake 路径**：`src/lib/conversions/intake.ts` 的 `buildIntakeRow(input, ctx)`，而不是手写 insert。`input.outcomeKind` 传 `'purchase'`（定金）/`'balance'`（尾款）、`amount`/`currency` 用表单收的值、`occurredAt` 用表单收的到账日期、`customerEmail`/`customerPhone` 从 `booking.contact_id` 关联的 `contacts` 行读（`buildIntakeRow` 强制至少要有邮箱或电话之一，拿不到就在表单上提示「该联系人无邮箱/电话，此单收款证据留档但发不出去 Meta」而不是拦截整个流程——收款事实要留档，发送匹配是下游的事）、`sourceKind='api'`、`sourceRef='tour_booking:<booking_id>:deposit'`（尾款用 `:balance`）、`clientId`/`contactId` 取自 booking。
- `buildIntakeRow` 校验失败（金额非法、币种不支持等）直接在表单里报错，不允许绕过校验直插库。
- 幂等由已有的 `uq_me_sale_outcomes_source (client_id, source_kind, source_ref)` 保证——**连点两次不会双发**。
- 后续人工审核 → CAPI 发送，**全走已有的那条链，一行新逻辑都不写**。
- 「这单收了多少钱」在看板上通过 `source_ref` 反查显示。
- **不新增任何事件名**。冻结契约 `me/crm.deal.closed` 的上游是外部 CRM；ME 自己确认的成交走 `me_sale_outcomes` 现有通路。若将来要 emit，必须沿用 `me/crm.deal.closed` 这个名字（契约里写着「不能改」），不许自造 `me/travel.deal.confirmed`。**这一条要在 PR 里对 `2026-09-07-crm-deal-closed-event-contract.md` 补一句「上游可能是 ME 自己」。**

### 3.4 占用怎么算 —— 单一状态机派生，三态返回

```
计入占用的 booking 状态 = OCCUPYING_STATUSES = ('held', 'confirmed')
occupied(departure) = Σ tour_bookings.seats   WHERE status ∈ OCCUPYING_STATUSES
                    + Σ departure_seat_holds.seats WHERE status='active' AND expires_at > now()   -- ④ 才有
remaining(departure) = seats_total - occupied     -- seats_total 为 NULL 时 remaining 也是 NULL
```

三条硬规则：
1. **`OCCUPYING_STATUSES` 只定义一次**，CHECK 约束和查询都引用它。加一条测试断言「状态机全集 ⊇ 占用集」，防止 v1 那种「公式里写了个不存在的状态、又漏了默认状态」的错。
   > v1 的实际错误：公式写 `('confirmed','deposit_paid','paid_full')`，而 CHECK 是 `('reserved','deposit_paid','paid_full','cancelled')`——`confirmed` 不存在，默认值 `reserved` 被漏掉。员工录一家 4 口，看板显示「已订 0」。
2. **占用是三态：`number | null | 'unknown'`**。`null` = 容量未设置；`'unknown'` = 任一子查询失败。**绝不许把查询失败算成 0**——那会显示成一个看起来完全正常的满仓数字，比空列表更骗人。
3. **`'unknown'` 必须让 ④ 的下单闸 fail-closed**（算不出剩余就拒绝下单）。

**不存 `seats_taken` 计数器**：8 个团几十条报名，现算开销可忽略；计数器一次漏改就让「还剩几个位置」开始骗人，而那正是这个功能存在的唯一目的。数据量涨到万级再加物化视图（Scope 闸）。

### 3.5 booking 与 `contacts.stage` 的关系（v1 这一段被 2 审判定「自称说死、实际没说死」）

现有代码里最强的不变量是「**绝不覆盖人工判断**」：
- `src/lib/crm/stage-infer.ts:261` UPDATE 带 `.is('stage', null)`
- `src/lib/crm/qualified-buyer-autotag.ts:200` UPDATE 带 `.or('stage.is.null,stage.in.(...)')`
- `src/lib/crm/stage-from-conversation.ts:62` 的 `SAFE_STAGES` 故意排除 `deposit_paid` / `paid_full`，注释：「牵扯钱 —— 那得看账不看话」

也就是说**今天 `deposit_paid` / `paid_full` 只有人手能写**。本方案会是第一个自动写入者，所以规则必须写死：

1. **方向单一**：booking / 收款 → contact.stage，**永不反向**。员工手改 stage 不回写 booking。
2. **「最靠前」定义死**：取该联系人**在当前在售出发团上**、未取消的单里，映射阶段 `sort_order` **最大**的那一档（= 漏斗最深）。**历史团不参与**。
   > 这解决了 v1 的二义：老客人去年付清黄山团、今年新报圣诞团，不会被拉回前段当新线索群发。
3. **UPDATE 必须带条件，且条件要验证「当前档位是谁写的」，不能只看档位取值落不落在允许集里**：只检查 `stage ∈ 允许被自动推进的档位集` 不够——员工把联系人手工设成 `contacted` / `quoted` 这类本身就在允许集里的档位后，下一次自动派生一样会命中并覆盖人工判断，因为看到的只是「档位取值可推进」，看不出「这个值是人刚填的」。`contact_stage_events.changed_by` 已经区分人工 / 系统变更，UPDATE 的 WHERE 必须把它纳入。**不能只比较字面量 `'system'`**——实测现有两个自动写入者都不写这个字面量：`src/lib/crm/stage-infer.ts` 的 `STAGE_INFER_ACTOR = 'ai:conversation-read'`、`src/lib/crm/qualified-buyer.ts` 的 `AUTO_TAG_ACTOR = 'system:qualified-buyer'`。只在 (a) `stage IS NULL`，或 (b) 该联系人最近一条 `contact_stage_events` 的 `changed_by` **属于「系统 actor 集合」**（当前档位本身就是上一次自动派生写的，还没被人碰过）时才允许写。这个集合必须显式枚举并集中定义（例如 `src/lib/crm/system-actors.ts` 导出 `SYSTEM_STAGE_ACTORS = [STAGE_INFER_ACTOR, AUTO_TAG_ACTOR, TOUR_BOOKING_STAGE_ACTOR]`，本方案的派生器新增一个自己的 actor 常量、同样纳入集合），新增任何自动写入者都必须把自己的 actor 名字加进这个集合，否则要么把彼此的自动结果误判成人工改动（命中 0 行，见下方后果），要么反过来把系统写入误判成人工写入而允许被覆盖。只要最近一条的 `changed_by` 不在这个集合里（真正的人工改动，操作者邮箱），一律命中 0 行。
   > **后果示例**：联系人若已被 `stage-infer` 或 `qualified-buyer-autotag` 自动打过阶段（`changed_by` 是 `ai:conversation-read` 或 `system:qualified-buyer`），若判断条件只认字面量 `'system'`，首次 booking/收款派生会把它误判成人工改动而命中 0 行；随后第 373 行「`stage-infer` 排除有 booking 的联系人」又会挡住 `stage-infer` 再处理它，真实的定金/尾款阶段永久卡住不更新。
4. **取消的收尾必须显式，回退阶位必须来自客户配置，不能硬编码 `contacted`**：一条未取消的单都不剩时，必须写回一个可营销的阶段 + 落 `contact_stage_events` 审计。回退到哪一档，从 `client_pipeline_stages`（或 `clients.leads_config`）读该客户显式配置的「取消回退档位」——CTS 的 9 档种子数据把它配成 `contacted`，但那是 CTS 的配置值，不是代码里的默认值，换一个不用 CTS 九档模型的旅游客户，这个值必须能配成别的档位或者根本没有 `contacted` 这个档。**该客户没配置回退档位，或配置的档位名在 `client_pipeline_stages` 里找不到匹配行 → fail closed**：不写 `stage`，落人工待办说明「客户未配置取消回退档位」，不许套用别的客户的档位名，也不许置回 `NULL`。
   > 两种偷懒写法都会出事：保持 `paid_full` 不动 → 退订的客人被 `marketing_action='won'` 永久 suppress，再没人联系他；置回 `NULL` → `stage-infer` 专挑 `stage IS NULL` 的人读历史邮件（里面写着「定金已付」）→ 又把他填回 `deposit_paid` → 又被 suppress。
5. **映射表进客户配置，不进代码**：`booking.status + 收款事实 → stage_key`（含上面第 4 条的取消回退档位）写在 `clients.leads_config`（已存在的 JSONB 列）或 `client_pipeline_stages` 的一列。阶段档位本来就是按客户可配的（CTS 那 9 档只是 seed），写死在 `src/lib` = 客户语义进 shared runtime（红线 2），也让第二个旅游客户接不进来。`contacts.stage` 本身没有外键约束，写入一个客户配置里不存在的档位名不会报错，只会留下一个 `client_pipeline_stages` 匹配不到的孤儿键——所以第 4 条的 fail closed 检查必须在写入前做，不能指望数据库层拦。
6. **`stage-infer` 要加排除条件**：本人有过 booking 的，不再由邮件推断阶段。
7. **交互说明**：每次自动派生会产生一条 `changed_by=`（本方案自己的系统 actor 常量，见上方第 3 条）的 `contact_stage_events`，`day-list.ts:389-455` 的「今天改过阶段变灰不消失」逻辑会把这些人算成「今天改过」。行为上可接受，但要在 PR 里写明，别让员工困惑。

---

## 4. ③员工看板

挂在客户工作区下，与 CRM 平级（库存不是 CRM）：

| 路由 | 回答哪一问 | 内容 |
|---|---|---|
| `/dashboard/clients/[id]/tours` | 有多少个 tour 在卖 | 产品列表 + 每个产品下的出发团数、总容量、总占用 |
| `/dashboard/clients/[id]/tours/[departureId]` | 这个团招得怎么样 | 出发团详情 + 报名名单 + **可编辑座位数** |

**列表每行**：出发日期 · 出发城市 · 天数 · 价格（无价显示「未标价」） · `已订 X / 共 Y`（Y 未设显示「容量未设置」） · 剩余 · 直招 vs 代理拆分 · 收款情况。

**详情页**：报名名单（姓名直链回 CRM 联系人 · 人数 · 来源 · 代理 · 收款状态 · 备注）+ 「加报名」表单 + 「设置座位数」入口 + 「标记已收定金 / 已收尾款」入口（**不是一次点击写库的按钮**，是收「实收金额 + 到账日期」的小表单，走 §3.3 的 `buildIntakeRow` 落 `me_sale_outcomes`）。

**四条硬规则**：
1. **读失败不许渲染成 0 或空**。占用为 `'unknown'` 时显示「读不到，不代表没人报」。
2. **容量未设置显示「未设置」，不是 0**。
3. **超卖只警告不阻断**（员工可能故意收候补），行标红提示，不拦。硬拦只在 ④ 的代理入口。
4. **员工「加报名」也走加锁函数**（见 §5.2），只是把「允许超卖」作为显式参数传 true——**不是走另一条不加锁的路**。

---

## 5. ④Agent 门户 —— 本方案只留结论，细化拆到单独文档

2 审一致判定：**④ 现在深度不够，不具备再审条件**（4 条独立失效路径 + 2 个越权面）。因此本方案只保留三条结论，实施设计另起 `docs/specs/…-travel-agent-portal-spec.md`。

### 5.1 复用结论（成立但被 v1 夸大了）
ME 已有邮箱验证码登录（`/api/auth/magic-link` + `/api/auth/verify-otp`）、授权表 `client_portal_users`、分级映射 `src/lib/auth/access-types.ts`。代理可以复用**登录**，加一个 `access_type='agent'`；`travel_agents` 档案表已在②建好（见 §2.8），④只需要给它加登录关联列，不用新建表。
**但**：「代理只能看自己的客人」是**客户内再按 agent_id 二次收窄**，ME 今天**完全没有**这一层，是全新授权逻辑。v1 说「砍掉了外部账号体系的绝大部分风险面」——砍掉的只是登录，授权层没砍多少。

### 5.2 ④ 的前置条件（不满足不开工）
1. ①②③ 上线并跑满一个真实报名周期。
2. **先堵 5 个放行口**：`/prospect` 分支（middleware 22-33 行，无 membership 检查）、`api/mtc/checkout`（**外部代理能对客户账户发起 Stripe 付款**）、`api/mtc/balance`、`api/clients`、`api/onboard/self`（会触发计费副作用）——这 5 处查 `client_portal_users` 时**都没有 access_type 过滤**。这是 ④ 的**前置条件**，不是 ④ 内部的一步。
3. **鉴权覆盖面**：`src/middleware.ts` 的 `config.matcher` 只覆盖 `/dashboard` `/portal` `/prospect`，**不覆盖 `/api/*`**（仓库自己在 `require-session.ts` 注释里写明）。所以代理门户的每个 API 路由必须各自调守卫；新前缀必须进 matcher。回归测试要断言这 5 个入口对 `'agent'` 全部拒绝——**不是**断言「'agent' 不在那两个数组里」（`ACCESS_TYPES_PORTAL` 运行时零引用，锁它等于虚假安全感）。
4. 加 `access_type='agent'` 时必须同步改三处：DB CHECK、`ACCESS_TYPE_VALUES`（有测试断言两者同步）、`tierForAccessType`。
5. PM 对 §0.5 两条拍板项给出答案。
6. 单独 PR + 子牙/魏征 2 审 + **狄仁杰安全复审**。

### 5.3 防超卖的技术结论（这部分 2 审认可，直接带进新文档）
- **占位过期靠算不靠任务**：有效占位 = `status='active' AND expires_at > now()`。正确性不依赖任何 cron 准时。
- **所有增加占用的写入走同一个 Postgres 函数**，函数内 `SELECT ... FROM tour_departures WHERE id=$1 FOR UPDATE` 先锁行再重算。**员工手工录入不例外**——否则锁只防住了「代理 vs 代理」，员工那条路一插就超卖。
- **占位转 booking 时必须重新加锁重算**：占位在 T 时刻失效、座位已被别人拿走，员工 T+1s 点确认 → 不重算就直接超卖，而且是已收钱的单。容量不足时 fail-closed + 落人工待办，不许静默成功也不许静默丢弃。
- **函数必须 REVOKE**：Supabase 默认把新函数的 EXECUTE 授给 `anon` / `authenticated`。照 `20260904000001_geo_client_budget_ledger_v1.sql:266-271` 的写法 `REVOKE ... FROM PUBLIC, anon, authenticated` 再单授 `service_role`，否则 `scripts/db-invariants.sql` 不变量 4 直接把 CI 打红。
- **占位要有上限和 TTL**：单个代理未转化占位数量上限（否则建 12 个占位就能锁死一个团），TTL 默认值要定。
- `departure_seat_holds` 需要 `(departure_id, status, expires_at)` 索引。
- **代理下单流转上 Inngest**（跨步骤接力 + 外部可见副作用，命中 CLAUDE.md §3）：`me/travel.agent_order.submitted` → 员工确认 → `me/travel.seat_hold.expired`。**人工审核只推进到下一个事件，不等于成交授权。**

---

## 6. 实施顺序与验证（A 级）

| 步 | 内容 | 验证证据 |
|---|---|---|
| 1 | migration：`tour_products` / `tour_departures` / `travel_agents` / `tour_bookings`（顺序必须如此——`tour_bookings` 引用 `travel_agents`，见 §2.8） | 本机 PG 沙盘真跑 `scripts/db-replay-and-verify.sh`，证明能从零重放 |
| 2 | 占用计算 | 边界用例：容量未设(NULL) / 0 座位 / 恰好满 / 超卖 / 已取消不计 / 多人单按 seats 计 / 子查询失败返回 `'unknown'` |
| 3 | 日期解析纯函数 | 同一输入在 `TZ=UTC` 与 `TZ=Pacific/Auckland` 下结果相等 |
| 4 | chinatravel 同步 | 真实 `tours.ts` 跑一次：**产品 32 行、出发团 25 行**；圣诞两个 slug 各 1 行；749/962 两处计算展开必须解出日期而不是 0；解析失败落待办 |
| 5 | 收款接 `me_sale_outcomes` | 连点两次「已收定金」只产生 1 行（幂等索引生效） |
| 6 | 阶段派生 | 人工改过 stage 的联系人，派生命中 0 行；取消最后一单后 stage 落到可营销档而不是 NULL |
| 7 | **第二个旅游客户接入测试** | 建虚构旅游客户，**只插数据 + 改配置、不改一行代码**，跑通「建团 → 设容量 → 录报名 → 看板显示剩余」 |
| 8 | 看板 UI | 截图 + 读失败态截图 + 容量未设置态截图 |
| 9 | RLS / 函数授权 | 新表用 anon key 实测读写被拒；新函数 anon 无 EXECUTE |
| 10 | cron | `render.yaml` 条目在同一个 PR 内；密钥环境变量组已 link |

**不做的（Scope 闸）**：物化视图、计数器触发器、官网回写 API、代理门户任何代码、`tour_products` 的 draft/paused 态、`tour_departures` 的 departed 态（当前无调用方）。

---

## 7. 候选登记（待 PM 一句「记」）

| 候选 | 层级 | 归属 | 证据 |
|---|---|---|---|
| **A** 出发团台账领域模型（product → departure → seats → 订位单 → 直招/代理） | L2 · ME 旅游版 | ME 旅游版 | PM 2026-09-08 定性为行业通用；实现证据 1/2 旅游客户 |
| **B** 容量型资源的原子占位（锁行 → 重算 → 超了拒绝 → 过期靠算不靠任务） | L1 候选 · 默认降级不直建 | 平台基础设施 · Kernel/并发 | 跨行业成立（电商 SKU / 地产带看 / 课程席位 / 外呼并发）；1/2 行业 |
| **C** 可售状态作为营销闸门（售罄 → 停投广告 / 停群发 / 停排内容） | L1 候选 · 默认降级不直建 | 平台基础设施 · Measurement/Governance | 1/2 行业（电商缺货停投同形状） |

登记须同时写 `docs/registry/platform-candidates.md` **和** `src/lib/pm-todo/platform-candidate-reviews.ts`（漏写第二个 = 复查永远不会被提醒）。

---

## 8. Reuse Statement

- **复用了什么**：`me_sale_outcomes` + `me_conversion_writebacks` 收款与 CAPI 回传全链（**不新建钱的账本**）· Supabase Email OTP 登录 · `client_portal_users` + `access-types.ts` · `contacts` / `contact_identities` 身份合并 · `contact_stage_events` 审计 + `client_pipeline_stages` 可配置阶段 · `clients.leads_config` 配置位 · `src/lib/cms/github-client.ts` 读 chinatravel 仓 · `pm-todo/manual-items.ts` 人工待办管道 · Inngest（④）
- **本次会新增的 `src/lib/` 共享代码**（v1 声称「无」是错的，此处更正）：`src/lib/travel-inventory/` —— 占用计算、日期解析纯函数、阶段派生器、chinatravel 适配器。**这些是 L2 ME 旅游版的共享代码，不是 L1 平台能力**，里面不许出现任何客户名 / 客户 ID / 具体团名。
- **industry-specific**：三张表的领域形状 + `src/lib/travel-inventory/` → L2 候选 A
- **client-specific**：CTS 的 tour / 日期 / 价格 / 容量 / 报名人 / 代理名单 / 阶段映射 → 数据行与 `leads_config`
- **有没有把客户名 / ID / 行业判断写进 shared runtime**：没有。`c0000000-...` 只在 seed 出现，且照既有做法带 `WHERE EXISTS` 守卫。
- **学习边界**：结论留在 client-private + 候选表，未升 industry/global。

---

## 9. 已知薄弱点（主动交代）

1. **内容双真相源**：内容在官网仓、库存在 ME。官网改团名而 ME 没同步 → 看板显示旧名。且 `cts-meta-pr` 会自动改写 title，两个自动化动同一个文件。
2. **容量全靠人填**：源数据几乎没有容量，看板上线初期绝大多数团是「容量未设置」。这是如实反映现状，不是 bug，但需要 CTS 员工投入一次填表。
3. **占用现算**：万级数据要改法，现在故意不提前优化。
4. **阶段派生方向**：靠 UPDATE 条件 + code review 保证，没有数据库层强制。
5. **候补没有独立状态**：员工故意收候补时占用会超过容量，`remaining` 为负；④ 上线后会让该团对所有代理锁死，需要在 ④ 的方案里处理。
6. **④ 佣金只记账不动钱**：刻意的范围限制，不是遗漏。

---

## 10. 2 审记录

| 审查 | 结论 | 处理 |
|---|---|---|
| 子牙（架构） | CONDITIONAL PASS · 6 blocker | B1 钱重复建账 → §3.3 改为引用 `me_sale_outcomes`；B2 事件契约 → §3.3 不自造事件名；B3 departure_code → §2.5 删掉；B4 鉴权 5 个放行口 → §5.2 列为 ④ 前置；B5 阶段派生覆盖人工 → §3.5 七条；B6 seats_total 无来源无入口 → §2.4。N1-N8 除「删 currency」外全部吸收 |
| 魏征（挑刺） | FAIL · 10 blocker | B1 状态机对不上 → §3.4 单一状态机；B2 seats_total → §2.4；B3 取消不回退 → §3.5-4；B4「最靠前」二义 → §3.5-2；B5 读失败算 0 → §3.4 三态；B6 middleware 不覆盖 API → §5.2-3；B7 函数默认匿名可执行 → §5.3；B8 员工录入绕过锁 → §4-4 / §5.3；B9 占位转换竞态 → §5.3；B10 日期时区 + 城市无源 → §2.5。H1-H10 / M1-M5 全部吸收 |
| 事实更正 | 两审共指出 7 处 | §2.2 表格（32 tour / 25 出发团 / 1 个 maxGroupSize / id 与 slug 均不唯一 / 2 处计算展开）· §2.2 圣诞团理由更正 · §2.7 删掉 RLS 误报（已实测生产库确认无此问题） |

**两审均要求：改完再审一轮，才能进 PM 授权与五道 Build Gate。**

| Codex round-2 复审（自动化） | 4 条 P1 | ①产品边界冲突 → 新增 §0.5-3，PM 未表态前①②③不许进 migration；②代理跨客户串号 → `travel_agents`/`tour_bookings` 加复合外键（§2.8、§3.2）；③收款按钮无可落库输入 → §3.3/§4 改为收实收金额+到账日期并复用 `buildIntakeRow`；④阶段派生系统 actor 判断只认字面量 `'system'` → §3.5-3/7 改为枚举实际 actor 常量集合 |
