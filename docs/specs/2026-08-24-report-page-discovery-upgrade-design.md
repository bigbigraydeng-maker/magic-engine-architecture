# 冷邮件报告页(/report/[id])升级为张骞 Discovery 数据 — 设计方案 v2

> 状态:v3,已过子牙(架构)+ 魏征(挑刺)+ 板桥(非技术)三方复审并改过一版,§7 三个问题 PM 已拍板,方案定稿,待 PM 授权后进入实现
> 触发:PM 要求把 `/report/[id]` 报告页改成用张骞 Discovery 的完整数据渲染
> 风险级别:B级偏A(触碰对外 C 端页面 + 加表 + 影响自动化冷邮件文案生成,定为 B 级 + 板桥必审)

## 给 PM 看的三句话摘要

**改什么**:给闽商(及未来其他)潜客的免费诊断报告页,背后的数据从"猜测型轻量诊断"换成"真实扫描数据"(真实同行流量、真实关键词库、政府登记核验),页面长相基本不变。
**花多少钱**:每家潜客多花约 NZ$0.9(是现在的 3.8 倍),不会自动扩大范围——先挑一小批试,试的结果谁看、看什么、什么条件算通过,§7 需要你拍板。
**要你看什么**:两处文案有翻车风险——"企业已核验"徽章可能让人觉得"你们在查我",竞品数字对比可能让华人老板觉得"你们是不是想看我笑话"——§6 给了改法,你确认一下方向就行。

---

## 0. 先纠正 v1 里一个错的前提(魏征复审发现)

v1 说"不整页换成 ReportView,是因为已经发出去的中文冷邮件配深色英文仪表盘会违和"——**这个理由是错的**。核实了 `/report/[id]/page.tsx` 全文,这个页面从设计之初就是**纯英文**、面向新西兰本地各行业商家(律师/牙医/装修师傅通用),跟这次给闽商发中文邮件是两件独立的事,不存在"这个页面本来是给中文场景设计的"这回事。

修正后的真实理由(不涉及语言):`/report/[id]` 是一条已经调好的两步定价转化漏斗,`ReportView` 是给已签约客户/自助访客看的审计仪表盘,两者服务的**决策阶段不一样**(第一次收到陌生邮件 vs 主动来查/已经是客户),不应该因为"数据升级"就把转化设计换掉。这个判断本身站得住,只是 v1 给错了理由。

**另外单独提一句(跟这次改造无关,是这次闽商外联批次自己的遗留问题)**:我们已经发出去的 18 封中文冷邮件里,故意没放报告页链接,原因正是"报告页是纯英文,配中文邮件会违和"——这个判断是对的,而且和这次要不要把报告页升级成 Discovery 数据是两件事:升级不会让报告页变成中文,报告页要不要出中文版是另一个独立待办,不在这次范围内。

## 1. 现状:代码库里已经有 4 个"给潜客/客户看报告"的页面

| 页面 | 入口场景 | 数据源 | 渲染组件 | 商业机制 |
|---|---|---|---|---|
| `/report/[id]` | **冷邮件**:陌生商家收到我们发的邮件,点链接进来 | `outbound_prospects.ai_report`(`ProspectAnalysis`,轻量版,~$0.15) | `src/app/report/[id]/page.tsx` 内联(ivory/gold ME VI 品牌,纯英文) | 两步转化:$19.90 起步 → $990 全案,带 90 天计划"锁定预览"、担保、`ReportLeadForm` |
| `/prospect` | **自助**:访客自己在官网输入自己的域名 | 现场跑 `runZhangqian(domain)`(完整版,~$0.57) | `ReportView`(`src/components/prospect/ProspectReportView.tsx`,深色 slate/cyan 仪表盘风格) | "email gate" 后转 Portal 自助开户漏斗(P29.E) |
| `/portal/[clientId]/discovery` | **已签约客户** portal 内查看自己的 Discovery 报告 | `client_discovery.payload`(完整版 `DiscoveryReport`) | 同样复用 `ReportView` | 无转化机制,纯内部查看 |
| `/scan/report/[jobId]` | **ME Commerce** 选品扫描(跟这次任务无关,只是同名"scan/report"容易搞混) | 完整版 `DiscoveryReport`,但走 Commerce 场景 | 自己一套内联组件(未复用 ProspectReportView,已有轻微代码重复) | 挂在 `dashboard/commerce`,服务电商选品,不是外联获客 |

**结论**:PM 要的"张骞 Discovery 形式"特指 `ReportView` 那种深色仪表盘视觉,已经在 `/prospect` 和 `/portal/.../discovery` 两处真实使用。`/report/[id]` 用的是完全不同的 ivory/gold 销售页视觉。

## 2. 核心设计判断:不整页替换,只换数据深度(理由已按 §0 修正)

`/report/[id]` 是一整条设计好的转化漏斗:健康分卡片 → AI 搜索对比 → 五阶段漏斗诊断 → 模糊化 90 天计划 → $19.90/$990 两步报价 → 退款担保 → 留资表单。`ReportView` 是给已经主动来查/已是客户的人看的专业审计仪表盘,没有转化钩子。两者服务不同决策阶段的人,不应该因为数据升级就互换。

**方向:保留 `/report/[id]` 现有转化页结构,只把背后数据从 `ProspectAnalysis` 换成 `DiscoveryReport`。**

## 3. 数据结构改动

`outbound_prospects` 新增列(不复用 `ai_report`,类型差异大,判别式联合类型会让 `report.ts` 类型收窄变脏):

```sql
alter table outbound_prospects add column discovery_report jsonb;
alter table outbound_prospects add column discovery_report_status text
  check (discovery_report_status in ('not_run', 'running', 'completed', 'truncated', 'failed'));
comment on column outbound_prospects.discovery_report is
  '张骞完整版 Discovery 报告(DiscoveryReport,含 schema_version 字段),仅高优先级潜客跑;
   一般潜客继续只有 ai_report(ProspectAnalysis 轻量版)。';
comment on column outbound_prospects.discovery_report_status is
  '区分"从没跑过"和"跑了但失败/半成品"——不能靠 discovery_report 是否为 null 猜状态(子牙复审 P0)。';
```

**加 `discovery_report_status` 是子牙复审后新加的**:`discovery_report` 为 null 原来分不清是"从没触发"还是"跑了但失败清空了"两种情况,现在用独立状态列明确标注,呼应仓库里"空的三种来路"那条铁律。

`src/lib/prospecting/report.ts` 的 `buildLeakReport()` 改造规则(魏征复审后改成整体降级,不是逐字段降级):

```
if (discovery_report_status !== 'completed' || discovery_report?.meta?.truncated === true) {
  // 只要不是"完整跑完",整份 discovery_report 都不采信,退回现有 ai_report/audit 逻辑
  // 不做逐字段降级——truncated 报告可能 competitors 有数据但 keywords 是半成品,
  // 字段级降级会把不对称的半成品拼进页面(子牙复审发现的具体漏洞)
} else {
  // 完整版数据可用,走新逻辑
}
```

**双评分系统怎么处理(魏征复审发现完全没提,这次补上)**:`DiscoveryReport.diagnosis.scores`(六支柱)和现有 `health_score`(纯规则漏斗打分)是两套互不知情的算法。**决定:页面顶部大字打分继续用现有 `health_score`(经过验证、新老数据都能算),`discovery_report` 的六支柱分数不作为第二个头部大字出现,只作为漏斗各阶段"发现"文案里的支撑证据**(比如"SEO 支柱评分 28/100,原因是……")。不新增第二套对外展示的总分,避免同一页面两个数字互相打架。

`/report/[id]/page.tsx` 改动点:
- 竞品对比区块:见 §6(板桥意见,不能直接点名数字对比)
- 关键词区块:换成 `discovery_report.seed_keywords`(真实 SEMrush 数据)
- 新增信任标记:见 §6(板桥意见,徽章文案要加来源说明)
- `siteWeak` 判断:可用 `discovery_report.onpage_audit` + `technology_stack` 替换现在基于 `score_breakdown` 信号名的判断

**工作量重新估计(魏征指出 v1 低估了)**:不只是 `report.ts` 加分支——新增 3 个 UI 区块(流量对比/核验徽章/关键词表替换)各自都要走一遍文案+视觉+移动端走查,不是"数字换个来源"这么轻。改成:**中等偏大,预计 2-3 个 PR**(数据管道 1 个 + UI 区块逐个上 1-2 个),不是 v1 说的 1-2 个。

## 4. 影响面(魏征复审发现 v1 只看了 `/report/[id]` 一处,遗漏两个真实消费者)

`buildLeakReport()` 目前还被这两处调用,改造后必须一并验证,不能只测 `/report/[id]`:

- `src/lib/prospecting/pipeline.ts` 的 `draftBatch()` —— 被 `prospecting-sweep` cron 调用,**直接产出自动化冷邮件正文**,如果 `buildLeakReport()` 输出变化,批量外联的邮件内容会跟着变
- `src/app/api/admin/prospecting/outreach/route.ts` —— FDE 手工触发外联的界面,同样依赖这个函数

`PipelineCRM.tsx`/`OutreachQueue.tsx` 直接读 `p.ai_report`(不是 `discovery_report`),这次不改 `ai_report` 列本身,**内部看板不受影响**。

## 5. 成本、试跑范围与代码级闸门

- 完整版扫描 ~$0.57/次(P8.13 基线),是短版(~$0.15)的 **3.8 倍**
- **代码级闸门(魏征复审要求,不能只是文档里写"建议"两个字)**:`runZhangqian()` 的调用点必须是**显式白名单/参数触发**,不能被 `prospecting-sweep` 现有的 `analyzeBatch`/`draftBatch` 循环隐式捎带上——具体做法是新建独立的 admin route(比如 `POST /api/admin/prospecting/discovery-upgrade`),接受一份 prospect id 列表作为入参,不接入现有 cron 的自动遍历逻辑。这样"先小范围试跑"是代码结构上的硬限制,不是靠人记得住的口头约定
- **cron 资源隔离(子牙复审发现 v1 完全没提)**:完整版扫描 18 次工具调用会打同一批外部服务(DataForSEO/Jina/Apify),跟 `prospecting-sweep` 每 30 分钟一次的常规 audit/analyze 抢配额。批量试跑必须走独立脚本/route,不进现有 cron 循环,且自带独立的每日成本上限(参考 `prospecting-sweep` 里已有的 `DAILY_ANALYZE_CAP` 先例,新流程要有等价的硬顶,不能靠人工记得别跑太多)
- **试跑验收条件(PM 已拍板)**:
  - 样本量:30 家(这次 18 家 + 后续新发现的 12 家 qualified 潜客)
  - 指标:**FDE 主观判断**(不追硬数字)——FDE 把这 30 家的新旧两版报告并排看一遍,给一个"新版是不是明显更有说服力"的判断
  - 决策人:PM(参考 FDE 的判断)
  - 为避免"先试试看"变成没有终点(魏征复审提醒过这类模式在项目里出现过):这 30 家跑完必须有**一次明确的收尾动作**——FDE 出一份简短的"看完新旧对比,建议扩大/建议先不扩大/建议改哪里再看"三选一结论,不能只是"跑完了但没人回头看"
- `advanced` 字段(GSC/真实广告账户数据)陌生潜客永远拿不到(无 Connector 授权),页面设计不能依赖这些字段

## 6. 板桥复审:两处文案/交互(PM 已确认方向,照此定稿)

1. **"企业已核验"徽章** —— 陌生老板看到自己工商信息被"核验",第一反应可能是"你们怎么查到我信息的,是不是在调查我",容易适得其反。**必须在徽章旁加一行极小字说明**:"资料来源:新西兰公司注册局(NZBN)公开登记信息,任何人都可查询"。
2. **竞品流量对比** —— 直接点名"隔壁同行月流量 12,000,你是 800"这种赤裸对比,对讲究"同行是冤家""家丑不可外扬"的华人生意圈,容易被当成"看笑话"而不是"专业诊断"。**改成不点名的行业标杆表达**:"你所在行业里,做得好的同行平均能拿到 X 的曝光,你目前还有提升空间",信息量不减,面子上过得去。
3. **90 天计划锁定预览** —— 数据越真实,"藏起来逼你付钱"这个钩子越容易显得是套路。**免费部分要多给一句真实结论**(哪怕只有一句,比如"你的问题主要出在 XX"),从"完全模糊"改成"给方向、藏细节"。
4. 板桥原话:"方向是对的,数据更真实确实比一堆模糊分数更有说服力,但徽章文案和竞品对比方式这两处必须重新设计,不能直接照方案上的写法上线。"

## 7. PM 拍板结果(2026-08-24)

1. **试跑验收指标**:FDE 主观判断(见 §5)
2. **§6 两处文案改法**:同意,照此方向写,不再另调整
3. **报告页中文版**:排进下一步——**这是独立于本方案的另一项工作**(报告页整体做中文/英文双语,不只是这次闽商批次),不在这次 §3-6 的实现范围内,留一条待办:`docs/ROADMAP.md` 需要补一条"/report/[id] 中文版"

## 8. 不建议做的事

- 不建议把 `/scan/report/[jobId]`(Commerce 场景)拉进来一起改
- 不建议现在决定 `/prospect` 自助漏斗要不要跟 `/report/[id]` 冷邮件漏斗合并成一套视觉——更大的产品决策,只标注技术债存在,不在这次范围
