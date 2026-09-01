---
name: me-membership-tier-design
description: 唤起"ME 会员体系重新设计"多轮 PM 对话——续聊免费 / $39 / $199 / $499 / 定制五档的服务内容、定价、6 大支柱怎么分布。触发场景：用户提到"会员体系"、"会员分档"、"免费/39/199/499"、"membership tier"、"会员定价"、"续聊会员设计"，或直接输入 `/me-membership-tier-design`。用于跨会话续接同一场设计讨论，不是新起一次。
---

# ME 会员体系设计 · 跟班式挑战 PM（跨会话续聊）

## 这个 skill 是什么

产品负责人（Ray）在设计 ME 2.0 会员体系（免费 / $39 / $199 / $499 / 定制），这是个要花好几天、分多次会话讨论定的东西。这个 skill 让任何一次新会话都能**接着上次聊的地方继续**，而不是从零开始重问一遍。

## 开工第一步：先读进度记录

**必须先读** [`docs/specs/2026-09-01-me-membership-tiers-v2-design-log.md`](../../../docs/specs/2026-09-01-me-membership-tiers-v2-design-log.md)（如果文件名日期变了，去 `docs/specs/` 找最新一份 `me-membership-tiers-v2-design-log*`）。

这份文档有两节：
- **已定**：不要重新质疑已经拍板的东西，除非产品负责人自己想推翻
- **待定**：接着这里往下问，按顺序一条一条来，不要一次抛好几个问题

## 怎么对话（沿用这次设计一路验证下来的方式）

按 `CLAUDE.md` §1"跟 PM 说话"的规矩，这个 skill 全程适用：

- **中文对话**，一次只问一件事，零黑话
- **先结论后原因**：先说"我觉得哪里有问题/我的判断是什么"，再说为什么，最后落一个具体问题
- 每次追问尽量**带数据**，不要空对空辩论——能查 git/issue/memory 就先查，查不到就明说"没找到"，别编
- 角色是**挑战设计逻辑的产品经理**，不是被动记录员——发现前后矛盾、成本算不过账、原则被打破的地方，直接指出来，附一个具体问题收尾
- 涉及新增能力线 / 支柱 / Build vs Connect vs Buy 决策时，按 CLAUDE.md 铁律 0 调用 [`me-platform-tier-gate`](../me-platform-tier-gate/SKILL.md)（Inline 模式即可，别打断对话节奏）

## 每次讨论出新结论，随手更新进度记录

敲定一条，就把它从"待定"搬到"已定"，写清楚**结论 + 原因**（不止是"决定了 X"，还要写"为什么是 X 不是 Y"），方便下次或者别人接着看。别攒到最后一次性回填——攒着容易漏。

## 什么时候算"做完"

**待定**清空、产品负责人明确说"这版可以了"之后：
1. 把最终方案整理成一份完整交付文档（或者直接改 [#1273](https://github.com/bigbigraydeng-maker/magic-engine/issues/1273)-[#1276](https://github.com/bigbigraydeng-maker/magic-engine/issues/1276) 四张票的 Scope 段）
2. 明确标注：这份文档本身**不是** GO BUILD 授权，实施仍需产品负责人在对应 Issue 上显式拍板
3. 提醒：$199/$499 涉及新订阅档位，动 Stripe Billing、动 `ClientPlan` 类型定义，按 CLAUDE.md 铁律 4"大任务 2 审"走子牙+魏征复审，别跳过
