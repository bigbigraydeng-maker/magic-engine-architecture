# Roman Hu 第三方地产平台清单 + 首轮审计 — 2026-08-21

> 背景：见 [`2026-08-21-marketing-plan-discussion.md`](./2026-08-21-marketing-plan-discussion.md) 第 4 条。PM 要求先列出 NZ 地产行业网站清单，抓一次 Roman 现有数据，再起草邮件给 Roman 本人核实/修正。本文档是清单 + 首轮公开数据审计的记录，也是未来「地产 Agent Industry Playbook」（见 memory `project-realtor-third-party-citation-playbook`）的第一份原始素材。

**方法说明**：以下全部是**公开页面只读核查**（WebSearch + 浏览器访问，未登录任何账号，未使用任何密码）。哪些平台需要真人登录去改，已在「待办」里标出。

---

## 1. NZ 地产行业网站清单（按对 Roman 的重要性排序）

| 平台 | 类型 | 为什么重要 |
|---|---|---|
| **Trade Me Property**（trademe.co.nz） | 全国最大房产门户 | NZ 用户量最大的地产平台；个人 agent profile 经 OneHub 管理；homes.co.nz 数据从这里同步 |
| **realestate.co.nz** | 全国第二大房产门户 | 与 Trade Me 并列的主流搜索入口 |
| **homes.co.nz**（Trade Me 旗下） | 免费估价 + 成交记录 | 高流量，AI/搜索引擎抓取频繁；agent profile 从 Trade Me 数据同步 |
| **OneRoof**（oneroof.co.nz，NZME 旗下） | 房产门户 + agent 目录 | NZME 媒体矩阵加持，DR 高 |
| **RateMyAgent**（ratemyagent.co.nz） | agent 评价/口碑平台 | NZ 地产行业事实标准的评价站，买卖家决策常参考 |
| **Neighbourly**（neighbourly.co.nz） | 本地社区 App | Roman 尚未注册（需真人 + 地址验证），见既有待办 |
| **Real Estate Authority 公共注册**（rea.govt.nz） | 政府官方持牌登记 | 权威来源，正确执业机构信息应以此为准 |
| Ray White 官方（raywhite.co.nz） | 雇主官网 | Roman 自己所有链接的"锚点"，其余平台应指回这里或 romanhu.com |

---

## 2. 首轮公开数据审计结果（2026-08-21 实查）

| 平台 | Roman 的页面 | 当前所属中介行 | 状态 | 备注 |
|---|---|---|---|---|
| RateMyAgent | [roman-hu-am220](https://www.ratemyagent.co.nz/real-estate-agent/roman-hu-am220/sales/overview) | **Ray White Mission Bay** ✅ | 正确，已认领(Claimed Profile) | 127 条评价，license #20086583。⚠️ 只挂了 FB/IG/Twitter 三个社媒链接，**没有 romanhu.com 反链** |
| Trade Me Property | [agent/Roman-Hu](https://www.trademe.co.nz/a/property/agent/Roman-Hu) | **Ray White Mission Bay (Five AM Bayside Realty Limited)** ✅ | 中介行名对，但内容有杂质 | 167 条评价。⚠️ "Awards" 栏仍挂着旧东家 Barfoot 的奖项，且日期新到 2024年9月（"Top Salesperson, Royal Heights Branch, 6 months ending September 2024"）——中介行是新的，履历却是旧的，混着看很奇怪。⚠️ "Serviced areas" 缺 Kohimarama、Glendowie（现在主打的两个 suburb），却留着 Te Atatu/Henderson/Avondale 这些老东家西区范围。⚠️ 页面有"Is this your profile? Showcase"提示，像是没被 Roman 自己认领/优化过 |
| **homes.co.nz** | [profile/barfoot-and-thompson/royal-heights/roman-hu](https://homes.co.nz/profile/barfoot-and-thompson/royal-heights/roman-hu) | **Barfoot & Thompson - Royal Heights** ❌ | **错——此刻仍在线** | 2026-08-21 实测，页面标题直接就是"Roman Hu Barfoot & Thompson - Royal Heights real estate agent"。PREMIUM 标记，且还在同步新房源（最新一条 2026-08-19 挂牌）——**不是废弃页面，是活跃在错东家名下的页面**，问题最大 |
| realestate.co.nz | 旧链接 `agent/553640/roman-hu` | — | 旧页已 404（"Missing agent"） | 不确定是"已下线待重建"还是"从没在这个平台建过 Ray White 版面"，需要真人登录 realestate.co.nz agent 后台核实 |
| OneRoof | 未定位到个人页 | 未知 | 待查 | 搜到的都是房源/办公室页面，没搜到 Roman 个人 profile 链接，需要登录 OneRoof/agent 后台核实是否存在 |
| Neighbourly | 无 | — | 未注册 | 沿用既有待办，需 Roman 本人真人+地址验证注册 |
| REA 官方注册 | 未查 | — | 待查 | 政府register，理论上应随执照变更自动更新，值得抽查一次核实 |

**一句话结论**：不是"全平台都没更新"，是**分化的**——RateMyAgent 全对，Trade Me 大方向对但细节脏，homes.co.nz 现在还活在错东家名下。homes.co.nz 这条尤其急，因为它是**当前唯一发现的、明确显示错误信息、还在实时更新的页面**。

## 2.1 各平台是否支持填个人网站（backlink）字段

| 平台 | 支持吗 | 依据 |
|---|---|---|
| homes.co.nz | ✅ 支持，而且**字段已经在用**——"Agent's website"当前指向 `https://www.barfoot.co.nz/r.hu`（旧东家自己的个人页），不是空的，是指错了地方 |
| Trade Me Property（OneHub） | ✅ 支持，官方帮助文档确认 profile 里有"personal website"可选字段 |
| RateMyAgent | ✅ 支持，官方帮助中心确认资料编辑页有专门的"website field"，跟社媒链接分开的字段 |
| realestate.co.nz / OneRoof | ❓ 未查实——这两个大概率是从中介行自己的后台/CRM 系统同步，不一定是 agent 自己能编辑的字段，没有实测不下结论 |

## 3. 待办（真人操作，需要 Roman 本人或有权限的人登录）

1. **homes.co.nz**（急）：改成 Ray White Mission Bay，或确认这是不是从 Trade Me OneHub 同步来的（如果是，改 Trade Me 那边可能会连带修好这里）
2. **Trade Me Property**：清掉/更新旧 Barfoot 奖项履历；补全 Serviced areas（加 Kohimarama、Glendowie，减掉西区老范围）；确认并认领"Is this your profile"提示
3. **RateMyAgent**：加一条 romanhu.com 官网链接（"Agent's website"或类似字段）
4. **realestate.co.nz**：核实新东家版面是否存在，不存在就建一个
5. **OneRoof**：核实个人 profile 是否存在
6. **Neighbourly**：Roman 本人真人注册（已是既有待办，非本次新发现）

以上全部需要真人登录各自后台（部分需要 Roman 本人账号密码），我们这边只做了只读核查，没有尝试登录任何平台。
