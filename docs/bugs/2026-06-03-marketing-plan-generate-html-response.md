# Bug: Marketing Plan 生成返回 HTML，前端 JSON 解析失败

> 发现日期：2026-06-03  
> 报告人：PM（CTS 测试 Phase 33 时遇到）  
> 严重程度：🔴 高（核心功能不可用）  
> 影响 Phase：**Phase 14.B 既有问题**，非 Phase 33 引入  
> 复现率：100%（PM 多次重试均失败）

## 现象

在 Marketing Plan 生成弹窗（`/dashboard/clients/[id]/goal/[goalId]`、`/dashboard/clients/[id]/marketing-plan`）点「✦ 生成 Plan 草稿」后：

- 前端 toast 显示错误：`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
- 含义：后端 `POST /api/clients/[id]/marketing-plan/generate` 返回了 HTML 页面，前端按 JSON 解析失败

## 触发路径

- 客户：CTS Tours NZ
- Initiative：Facebook + Google Ads — October 2026 Tours
- 关联 Campaign：2027 Silk Road Discovery
- 强度：标准
- 关注点：空

## 可能根因

1. **Claude API 调用超时**：`generatePlanData` 在第 4 步调 Strategy Engine，输出 token 大，可能 > 60s 触发 Render/CF 边缘层 502 HTML
2. **Render 部署后冷启动**：第一次调用因 Lambda 冷启动慢，超时
3. **Claude API 异常**：Claude 限流 / network 错误抛 HTML

## 已验证不是问题

- ✅ Phase 33 新增字段 `initiative_id` 写入逻辑正确（route.ts:173）
- ✅ Supabase migration 已跑（initiatives.campaign_ids / marketing_plans.initiative_id 两列已存在）
- ✅ 前端弹窗 UI 显示正常（标题预填 / Initiative 锁定显示 / 日期继承）

## 推荐修复方向

| 优先级 | 方案 | 工作量 |
|--------|------|-------|
| 🔴 高 | route.ts 加 try/catch 把 Claude 调用失败转成 JSON 错误响应（不让 502 HTML 透传到前端）| 30 min |
| 🟡 中 | 切换到 streaming 响应（避免 maxDuration=90 一刀切超时）| 4-8h |
| 🟡 中 | 前端 fetch 错误处理：detect `content-type !== application/json` 时显示友好提示 | 1h |
| 🟢 低 | 加 prompt 长度上限警告 | 1h |

## 待办

- [ ] 排查 Render logs，确认是 Claude 超时还是其他错误
- [ ] 修后端：route.ts 边界错误一律返回 JSON
- [ ] 修前端：错误处理统一 detect content-type

## 关联

- 不阻塞：Phase 33 M2 「Initiative → Marketing Plan」连线机制本身已验证通过（UI 正确显示锁定 Initiative）
- 阻塞：Phase 14.B 营销计划生成完整闭环
