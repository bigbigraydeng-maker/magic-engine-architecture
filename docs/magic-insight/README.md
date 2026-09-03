# Magic Insight 数据研究院 · 出版系列

> **这是什么**：以「Magic Insight 数据研究院」名义对外发布的行业研究报告系列，
> 面向 Magic Engine **高级会员（499 档）** 作为服务附送内容。
>
> **这不是什么**：不是调研工作区。原始调研材料、来源抓取、per-engagement 的过程产物
> 放 [`docs/research/`](../research/)，那边已有成熟约定（`YYYY-MM-DD-<主题>/` + `sources/*.md`）。
> **本目录只放已定稿、可对外的出版物。**

---

## 与 `docs/research/` 的分工

| | `docs/research/` | `docs/magic-insight/`（本目录） |
|---|---|---|
| 性质 | 调研工作区 | 对外出版系列 |
| 组织方式 | 按调研次数 `YYYY-MM-DD-<主题>/` | 按卷号 `volNN-<主题>/` |
| 内容 | 原始材料 · 来源抓取 · 过程记录 | 定稿报告 · 数据台账 |
| 受众 | 内部 | 高级会员（对外） |
| 是否过发布闸 | 否 | **是，强制** |

一次调研可能产出多卷，也可能一卷都不产出。两者不是一一对应，**不要互相复制内容**，用链接互指。

---

## 卷目录

| 卷 | 主题 | 日期 | 状态 | 目录 |
|---|---|---|---|---|
| Vol.01 | 中国入境游海外客源市场 | 2026-08-27 | 🔴 **已作废** | — |
| Vol.02 | 中国 → 澳洲零散单物流 | 2026-09-03 | 🔴 **已作废** | — |
| Vol.03 | 中国 → 新西兰小批量物流 | 2026-09-03 | ✅ 已发布 | [`vol03-nz-china-freight/`](./vol03-nz-china-freight/) |

### 为什么 Vol.01 / Vol.02 被作废

两卷在起草时**未跑任何一次实时数据查询**，却给自造数字配上了权威来源标注
（ABS、Google Ads Keyword Planner、国家移民管理局、Trip.com 财报）。
事后 34 个 agent 全量核查：**150 条数字里仅 13 条 VERIFIED**，
CONTRADICTED 64 · UNVERIFIABLE 32 · NO_SUCH_DATA_EXISTS 26 · CLOSE_BUT_OFF 15。

典型问题：
- 引用了**根本不存在的数据源航段**（FBX 大洋洲航段）
- 描述了一项**从未执行的调研**（「抽样约 40 家 · 审计时间 2026-08」及 16 项百分比）
- **真假掺杂**：北京客源表 8 国里 3 个与官方数据逐位吻合，另 5 个编造且系统性低估
  （法国印为 −2%，官方实为 **+24.9%**，正负号相反）——真数字反而给假数字背了书

两卷的 PDF 已从本机删除，源文件不入库。事故记录见
[`docs/registry/platform-candidates.md`](../registry/platform-candidates.md) 对应候选条目。

---

## 出品流程（强制）

### 1 · 先拿数据，再动笔

**不许凭记忆写数字。** 每个要印出来的数字必须先在一手页面上读到。
- 搜索量 / CPC / KD / SERP → 必须跑 [`src/lib/dataforseo/`](../../src/lib/dataforseo/)，留 receipt
- 官方统计 → WebFetch 发布机构自己的页面，不是转述它的博客或新闻
- 拿不到就写「未取得 + 原因」，**不许填估计值**

### 2 · 记数据台账

每卷目录下必须有 `sources.md`，逐条记录：数字 · 期间 · 口径 · 发布方 · URL · 置信度。
台账是发布闸的输入，也是日后被质疑时的唯一辩护材料。

### 3 · 过发布闸

```bash
npx vite-node scripts/magic-insight-prepublish-check.ts -- docs/magic-insight/volNN-<主题>/report.html \
  --receipt <凭证路径> --artifact <调研产物路径> --source "<来源名>"
```

有 blocking 项**不得发布**，退出码为 1。
七条规则与三类失败模式说明见 [`docs/sops/magic-insight-prepublish-data-check.md`](../sops/magic-insight-prepublish-data-check.md)。

⚠️ **闸门只覆盖「机械错」与「措辞风险」两类。**
「编造」类文本分析看不出来，只能靠 receipt / 产物强制——这是设计边界，不是遗漏。
所以第 1 步不能跳。

### 4 · 人工过四条闸门管不了的

1. 抽查 3–5 个**支撑核心结论**的数字，亲手点开一手源核对
2. 口径对得上吗（FY vs CY、货物 vs 货物+服务、不同机构的不同定义）
3. 同一件事在文档里说了两遍吗，两遍一致吗
4. **删掉所有拿不出凭证的数字后，论点还站得住吗**——站不住就是这一节要重写

---

## 目录约定

```
docs/magic-insight/
  README.md                    ← 本文件，系列登记簿
  volNN-<主题>/
    report.html                ← 报告源文件（PDF 是构建产物，不入库）
    sources.md                 ← 数据台账：每个数字 → 期间 → 口径 → URL → 置信度
```

**PDF 不入库**：由 `report.html` 用 headless Chrome 生成，属构建产物。
生成命令见各卷 `sources.md` 末尾。

---

## 品牌约束

- 署名统一为 **Magic Insight 数据研究院**，副题 `Research Series · Vol.NN`
- Magic Insight 是 Magic Engine 旗下**研究出品子品牌**，VI 与 ME 主品牌分开管理
  （主品牌 VI 见 [[reference-magic-engine-vi-package-location]]）
- 页脚必须写明数据分层说明与「不构成经营决策依据」
- **禁止**出现自证清白式表述（「所有数字均可反向溯源」等）——
  这类句子把举证责任压在自己身上，读者找到一处不成立整份就归零。
  发布闸会拦，但更该在写的时候就不写

---

## PM 已拍板的边界

| 项 | 决定 |
|---|---|
| 会员绑定 | **499 档**（通用 + 定制） |
| 发行节奏 | **不承诺**（品质优先于时间表） |
| 数据策略 | 三方公开源二次加工 + ME 现有抓取能力，**不新增付费订阅** |
| 定位 | 高级会员**服务附送**，不独立收费、不承担 P&L 硬指标 |

## PM 待拍板（未决，勿自行推进）

1. **法务边界** —— 免责条款措辞 + 三方数据引用授权。
   「ME 名义 + 研究院署名 + 发给付费客户」三信号叠加，建议正式发行前过一次法务。
2. **编委机制** —— 总编 / 各卷主编 / 发布前谁签字。
   工具与 checklist 已就位，但「谁按下发布键」是人的问题。

---

## 相关

- 平台候选登记：[`docs/registry/platform-candidates.md`](../registry/platform-candidates.md)
  「行业市场研究报告出品能力（Magic Insight 数据研究院）」
- 发布前核查 SOP：[`docs/sops/magic-insight-prepublish-data-check.md`](../sops/magic-insight-prepublish-data-check.md)
- 闸门实现：[`src/lib/magic-insight/prepublish-check.ts`](../../src/lib/magic-insight/prepublish-check.ts)
- 调研工作区：[`docs/research/`](../research/)

---

## 历史

- 2026-09-03 · 建立。同日 Vol.01 / Vol.02 因数据完整性事故作废，Vol.03 为首个过闸发布的卷。
