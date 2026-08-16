/**
 * shared 泳道 —— 跨业务线的平台件 / 共享能力 / 共享 adapter。
 *
 * 🔴 登记纪律（每个泳道文件同此）：
 * - 每条 integration 证据的 ref 在写入前都用 grep/ls 核实过（2026-08-15），
 *   registry.test 会持续对着磁盘复验；
 * - PR 只登身份，merged 与否由 external-facts 注入；
 * - 成熟度宁可保守：拿不准就低一级 + 写清 blocker。
 */

import type { ProductMapComponent } from '../types'

export const SHARED_COMPONENTS: readonly ProductMapComponent[] = [
  {
    id: 'platform.execution-kernel',
    name: 'Execution Kernel（执行内核）',
    componentType: 'platform',
    architecturalRole: 'kernel',
    businessLane: 'shared',
    dapeStages: ['authorization', 'execution', 'verification'],
    businessOutcome: '所有会产生外部副作用的自动执行都必须经过同一道授权闸，客户资产不被未经批准的动作碰到',
    description:
      '提交 action_run → 授权判定 → 分步执行 → 留痕回收的执行底座。代码已合并（PR #863 + 后续加固），但 4 张表未在生产建立、零生产调用方 —— 「代码在」不等于「在跑」。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M2_IMPLEMENTED',
    dependencies: [],
    linkedIssues: [859, 870, 881],
    linkedPullRequests: [{ number: 863, role: 'implements' }],
    ownedPaths: ['src/lib/kernel/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-08-me2-execution-kernel-v1.md',
        note: 'Kernel v1 契约（五轮评审后冻结）',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      {
        id: 'kernel-tables-not-applied',
        kind: 'provisioning',
        summary: 'action_runs / action_run_steps / authorization_decisions / client_automation_policies 四张表未在生产建立',
        ref: 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql',
      },
      {
        id: 'approval-surface-missing',
        kind: 'code',
        summary: '审批/拒绝界面（K-WP01）未交付，须人工批的动作没有入口',
        ref: '#881',
      },
    ],
    poDecisionRequired: [
      { kind: 'migration_apply', decision: '授权把内核 4 张表的 migration apply 到生产（回 go apply kernel 即可）' },
    ],
    nextMilestone: {
      target: 'M3_INTEGRATED',
      unlockedBy: ['kernel-tables-not-applied', 'approval-surface-missing'],
      note: '第一个真实调用方（WP07 页面修改走内核）接上后到 M3',
    },
    ownerRole: 'claude-code',
  },
  {
    id: 'platform.action-bridge',
    name: 'Action Bridge（候选身份治理）',
    componentType: 'platform',
    // ActionCandidate → ActionKey 的治理映射（WP00 §8），是 Kernel CAN/SHOULD/
    // AUTHORIZED 三问里 CAN 那问的注册表实现，不是独立的域推理。
    architecturalRole: 'kernel',
    businessLane: 'shared',
    dapeStages: ['prescription', 'authorization'],
    businessOutcome: '域模块产出的「动作候选」翻译成内核认识的 ActionKey，词汇表受治理不野蛮生长',
    description:
      'K-WP02 交付。MAPPING_TABLE 目前是刻意的空数组：零调用方、零生产 ActionKey 映射，等第一个域模块（WP05）进来才有第一条记录。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M2_IMPLEMENTED',
    dependencies: [{ type: 'requires', target: 'platform.execution-kernel', note: '只依赖内核类型与只读注册表' }],
    linkedIssues: [882],
    linkedPullRequests: [{ number: 898, role: 'implements' }],
    ownedPaths: ['src/lib/action-bridge/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-11-me2-kwp02-action-governance-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'mapping-table-empty', kind: 'code', summary: '映射表为空，等 WP05 第一个域模块提供第一条候选映射', ref: '#879' },
    ],
    poDecisionRequired: [],
    nextMilestone: { target: 'M3_INTEGRATED', unlockedBy: ['mapping-table-empty'] },
    ownerRole: 'claude-code',
  },
  {
    id: 'platform.growth-contract',
    name: 'Growth 契约（Finding / Prescription / ActionCandidate）',
    componentType: 'platform',
    // WP00 §5 的五个概念结构（Evidence/Finding/Prescription/ActionCandidate/
    // VerificationDefinition）是"任何 Domain Module 都按同一条五段链推理"（§4）
    // 的共用词汇表，语义上属于 Domain Module 这一层，不是独立角色。
    architecturalRole: 'domain_module',
    businessLane: 'shared',
    dapeStages: ['discovery', 'analysis', 'prescription'],
    businessOutcome: '所有域模块用同一套「发现 / 处方 / 动作候选」语言说话，模块之间可比较、可审计',
    description: 'WP01 交付的纯类型 + 校验器。零 importer —— WP05 GEO Module 是它的第一个约定消费者。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M2_IMPLEMENTED',
    dependencies: [],
    linkedIssues: [877],
    linkedPullRequests: [{ number: 890, role: 'implements' }],
    ownedPaths: ['src/lib/growth/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md',
        note: 'WP00 契约冻结的组成部分',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'zero-importers', kind: 'code', summary: '零 importer，等 WP05 成为第一个消费者', ref: '#879' },
    ],
    poDecisionRequired: [],
    nextMilestone: { target: 'M3_INTEGRATED', unlockedBy: ['zero-importers'] },
    ownerRole: 'claude-code',
  },
  {
    id: 'platform.kernel-approval-boundary',
    name: '内核审批边界（K-WP01A）',
    componentType: 'platform',
    architecturalRole: 'kernel',
    businessLane: 'shared',
    dapeStages: ['authorization'],
    businessOutcome: 'PO/FDE 能在受认证的入口批准或拒绝待批动作，而不是进数据库手改',
    description:
      '「只签授权，不执行」的服务端边界。PR #962 仍是 open draft —— 代码未进 main，' +
      '所以这里是 M0：登记了、还没交付（draft PR 不构成任何证据）。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M0_REGISTERED',
    dependencies: [{ type: 'requires', target: 'platform.execution-kernel' }],
    linkedIssues: [881],
    linkedPullRequests: [{ number: 962, role: 'implements' }],
    ownedPaths: [],
    contractEvidence: [],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'pr-962-in-review', kind: 'code', summary: 'PR #962 复审中，未合并', ref: '#962' },
    ],
    poDecisionRequired: [
      { kind: 'merge', decision: 'PR #962 复审线程全解决后决定是否合并（回 go merge 962）' },
    ],
    nextMilestone: { target: 'M2_IMPLEMENTED', unlockedBy: ['pr-962-in-review'] },
    ownerRole: 'claude-code',
  },
  {
    id: 'registry.canonical-page-inventory',
    name: '站点页面台账（canonical inventory）',
    componentType: 'registry',
    // 不是 WP00 第八层"Registry"——它是 Page 能力 resolve 段（WP06："路由决策
    // 与规范页面身份分开"）依赖的规范页面身份来源，语义上落在 Shared Capability。
    architecturalRole: 'shared_capability',
    businessLane: 'shared',
    dapeStages: ['discovery'],
    businessOutcome: '「客户网站到底有哪些页面」有一份人工审过、可信、可追责的长期真值，页面级动作不再各说各话',
    description:
      '#930 交付：发现 → 出台账计划 → 人工复核 → 激活 的纯逻辑层。没有 store 实现、没有 route/cron/UI 调用方（架构测试在盯）。PR #973 正在给它加生成时可信锚点（L1 信封）。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M2_IMPLEMENTED',
    dependencies: [],
    linkedIssues: [930, 932],
    linkedPullRequests: [
      { number: 956, role: 'implements' },
      { number: 973, role: 'extends' },
    ],
    ownedPaths: ['src/lib/site-audit/canonical-inventory/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'src/lib/site-audit/canonical-inventory/types.ts',
        note: "契约版本常量 'canonical-inventory-plan@1' 冻结在代码里",
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'no-store-impl', kind: 'code', summary: '没有生产 CanonicalInventoryStore 实现，也没有任何调用方', ref: '#932' },
    ],
    poDecisionRequired: [],
    nextMilestone: { target: 'M3_INTEGRATED', unlockedBy: ['no-store-impl'] },
    ownerRole: 'claude-code',
  },
  {
    id: 'capability.page-optimization',
    name: 'Page Optimization（页面修改共享能力）',
    componentType: 'capability',
    architecturalRole: 'shared_capability',
    businessLane: 'shared',
    dapeStages: ['execution', 'verification'],
    businessOutcome: 'SEO 和 GEO 共用同一门「改页面」手艺：定位 → 快照 → 草拟 → 差异 → 校验，不各造一套',
    description:
      'WP06 交付（#870 冻结：这是共享能力，不是 Agent 也不是域模块）。零线上写、零持久化、零调用方；对外真写要等 WP07 走内核授权。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M2_IMPLEMENTED',
    dependencies: [
      { type: 'consumes', target: 'adapter.github-cms', note: '快照读文件（只读）' },
      { type: 'consumes', target: 'adapter.wordpress-cms', note: '快照读文章（只读）' },
    ],
    linkedIssues: [878, 880],
    linkedPullRequests: [{ number: 895, role: 'implements' }],
    ownedPaths: ['src/lib/page-optimization/', 'src/lib/capabilities/page-optimization/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-page-optimization-capability-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'wp07-not-started', kind: 'code', summary: '内核授权的 apply/verify/rollback（WP07）未开工，能力没有安全的出口', ref: '#880' },
    ],
    poDecisionRequired: [],
    nextMilestone: { target: 'M3_INTEGRATED', unlockedBy: ['wp07-not-started'] },
    ownerRole: 'claude-code',
  },
  {
    id: 'adapter.meta',
    name: 'Meta 平台 adapter（Publishing/Ads/Messenger）',
    componentType: 'adapter',
    businessLane: 'shared',
    dapeStages: ['execution', 'verification'],
    businessOutcome: '发帖、投广告、收发私信这些动作能翻译成 Meta Graph API 调用',
    description: 'legacy 在跑：广告执行、页面发帖、留资同步、私信收件箱都走它。尚未以 ME2 adapter 契约重述。',
    origin: 'legacy',
    operationalStatus: 'operating_legacy',
    legacyOperationalNote: 'meta-ads execute 路由 + ad-readback-sweep 等多个 cron 每日在生产使用',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: ['src/lib/meta/', 'src/lib/meta-oauth/'],
    contractEvidence: [],
    integrationEvidence: [
      {
        kind: 'caller_route',
        ref: 'src/app/api/clients/[id]/meta-ads/execute/route.ts',
        verification: 'manual_claim',
      },
      {
        kind: 'importer',
        ref: 'src/lib/ads-strategy/readback-sweep.ts',
        note: '广告回读线的直接调用方(ad-readback-sweep cron 经它到 meta)',
        verification: 'manual_claim',
      },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
]
