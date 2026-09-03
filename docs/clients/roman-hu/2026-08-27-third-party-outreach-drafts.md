# Roman Hu 第三方平台纠错——沟通稿 — 2026-08-27

> 承接 [`2026-08-21-third-party-platform-audit.md`](./2026-08-21-third-party-platform-audit.md) 的审计结果。这几条都需要 Roman 本人登录/操作，我们只做了只读核查，没有登录任何平台。查证过程见文末"核实记录"。

## 给 PM 的一句话

**Trade Me 那条不用发邮件，是 Roman 自己登进 OneHub 改；homes.co.nz 如果 Trade Me 改完还没跟着变对，再发下面这条工单。RateMyAgent 也是自己登录加一个链接，不用发邮件。**

---

## 第 1 步（自助，不用发邮件）：Trade Me OneHub 更新资料

Roman 登录 [onehub.trademe.co.nz](https://onehub.trademe.co.nz/)（用 Ray White Mission Bay 的公司账号登录），在 Agent Profile 里：

1. **Agency & License Links** —— 确认挂的是 Ray White Mission Bay（不是老东家）
2. **Brand Assets → Servicing regions** —— 加上 Kohimarama、Glendowie，去掉 Te Atatu / Henderson / Avondale 这些西区老范围
3. **Awards** —— 删掉还挂着的 Barfoot 履历奖项（"Top Salesperson, Royal Heights Branch..."）

保存后最多 1 小时生效。**因为 homes.co.nz 的数据是从 Trade Me 同步过来的，这一步做完之后，homes.co.nz 那边有可能会跟着自动修正**——所以建议先做这步，过几天再看 homes.co.nz 是否自己变对了，没变对再走下面第 2 步。

---

## 第 2 步（如果 homes.co.nz 还没自动同步过来）：提交客服工单

**没有查到 homes.co.nz 公开的客服邮箱**（官方帮助中心也没列），homes.co.nz 是 Trade Me 旗下产品，走的是 Trade Me 统一客服入口：

**提交地址**：https://help.trademe.co.nz/hc/en-us/requests/new?contactus

**工单内容（Roman 可直接复制粘贴，英文，NZ 地产行业客服的标准工作语言）**：

> **Subject:** Incorrect agency shown on homes.co.nz agent profile — Roman Hu
>
> Kia ora,
>
> My homes.co.nz agent profile is currently showing the wrong agency and is actively displaying new listings under it, which is misleading to the public:
>
> https://homes.co.nz/profile/barfoot-and-thompson/royal-heights/roman-hu
>
> I am no longer with Barfoot & Thompson. I have been with **Ray White Mission Bay** since [Roman 本人填入实际入职日期]. Could you please update my profile to reflect my current agency, and also correct my "Agent's website" field — it currently links to my old Barfoot personal page (barfoot.co.nz/r.hu) and should link to my current site instead: **https://romanhu.com**
>
> My license number is 20086583 (REAA) if that helps locate the correct record.
>
> I've already updated my details on Trade Me OneHub — if this profile syncs from there, it may just need a refresh on your end.
>
> Thanks very much,
> Roman Hu
> Ray White Mission Bay

*(Roman 填一下入职日期那个括号,其他不用改。)*

---

## 第 3 步（自助，不用发邮件）：RateMyAgent 补官网链接

Roman 登录 [ratemyagent.co.nz](https://www.ratemyagent.co.nz/) 自己的 profile 编辑页，在资料里加一个 **"Website"** 字段（跟 FB/IG 链接分开的独立字段），填 `https://romanhu.com`。这个平台的所属中介行本身已经是对的（Ray White Mission Bay），缺的只是这一条官网反链。

---

## 暂不需要动作：realestate.co.nz / OneRoof

这两个平台目前不确定 Roman 是否有独立 profile（realestate.co.nz 旧链接已 404；OneRoof 没搜到个人页），需要先登进各自 agent 后台确认"有没有这个页面"，确认后才知道是要新建还是要改——这一步还没查实，先不写邮件草稿，免得 Roman 白跑一趟。

---

## 核实记录（2026-08-27，只读，未登录任何账号）

- `homeshelp.co.nz`（homes.co.nz 官方帮助中心）：未列出公开客服邮箱，仅提示"office admin 应该已有 Homes/Trade Me 客服的联系方式"
- `agent.homes.co.nz`：Portal 首页无公开联系方式
- `trademe.co.nz/c/property-industry/help`：确认统一客服入口为 `help.trademe.co.nz/hc/en-us/requests/new?contactus`
- `tmpropertysolutions.co.nz` 的 OneHub 教程：确认 Agency & License Links / Servicing regions / Brand Assets 均为 agent 自助编辑字段，保存后最多 1 小时生效
