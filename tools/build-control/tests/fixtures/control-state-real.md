## BUILD CONTROL — RECOVERY LOCKS V2 / COMPLETE PORTFOLIO STATE

Copied in shape from the real Issue #1140 state comment (`/tmp/me-control-1140-recovery.md`,
read 2026-08-30 NZST): a standalone marker line followed by a fenced JSON object, with prose
either side. This is the exact format the existing consumer reads; the parser in
`src/control-state.mjs` must accept this file and reject an inline
`<!-- ME_CONTROL_STATE_V1: {...} -->` payload, which the consumer cannot read.

<!-- ME_CONTROL_STATE_V1 -->
```json
{
  "schema_version": "ME_CONTROL_STATE_V1",
  "updated_at": "2026-08-30T02:04:00+12:00",
  "summary": "Build Control Recovery Locks V2 已完成安全 rehome；Draft PR 已关闭未合并，本地分支保持在冻结 HEAD，active writer 为 0。",
  "north_star": "让一条真实营销动作取得精确外部执行回执，并进入可比较的 T+24 Check，再用结果改变下一次决策。",
  "build_control": {
    "mode": "RECOVERY_REHOME",
    "wip_limit": 1,
    "active_wip_count": 0,
    "open_pr_count": 47,
    "main_sha": "423af321fa18e23d86256f1da17dcff56e67e0bc"
  },
  "current_p0": {
    "issue": 1225,
    "name": "Daily content IMPACT loop",
    "status": "NOT_READY_LOCAL_WORKER_VERSION_UNKNOWN",
    "next_action": "只读取得真实 worker PID、启动命令、checkout 路径与 HEAD",
    "next_gate": "READY FOR ONE CANDIDATE AUTHORIZATION 或 NOT READY",
    "ray_action": "当前无需 Ray 操作"
  },
  "portfolio_p0": {
    "current_stage": "事实源已恢复；recovery control-plane 等待一次性 remediation",
    "next_proof": "workflow 文件真实进入 exact HEAD，结构断言零跳过，真实 #1140 fixture 通过",
    "exit_condition": "一条内容获得受控发布回执并进入 T+24 可比较测量",
    "outcome_status": "NOT_PROVEN"
  },
  "product_capabilities": [
    {
      "capability": "Build Control governance / verification",
      "maturity": "LOCAL_REHOME_IN_PROGRESS",
      "issue": 1249,
      "head": "1949fbe6e796e64535c6c07f01e1c9d81c02757f",
      "next_gate": "exact-HEAD 双审通过后才推送 replacement Draft"
    },
    {
      "capability": "Daily content factory",
      "maturity": "CODE_MERGED_RUNTIME_UNKNOWN",
      "issue": 1225,
      "next_gate": "真实本地 worker 只读版本回执"
    }
  ],
  "customer_loops": [
    {
      "loop": "Daily social content",
      "status": "WAITING_RUNTIME_FACT",
      "evidence_gate": "#1225 / merged PR #1227",
      "next_decision": "worker READY 后才请求一条候选生成授权",
      "verified_outcome": "UNKNOWN"
    }
  ],
  "active_lanes": [
    {
      "issue": 1249,
      "role": "RECOVERY_GOVERNANCE_BOOTSTRAP",
      "executor": "NONE",
      "status": "LOCAL_REHOME_READY",
      "collision_boundary": "无模型调用、无费用、无 push"
    }
  ],
  "ray_needed": [],
  "bottleneck": "业务瓶颈仍是无法证明真实本地 worker 已加载最新 merge；控制瓶颈是 recovery 分支尚未通过 exact-HEAD 复审。",
  "gates": [
    "未授权任何 ruleset mutation",
    "未授权 deploy、migration、生产写入、provider 调用、内容生成或发布"
  ]
}
```

**KHZ decision:** `REHOME COMPLETE TO SAFE LOCAL STOP`.
