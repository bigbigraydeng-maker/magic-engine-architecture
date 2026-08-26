# Park Homes（parkhomes.nz）客户档案

## 联系人

| 字段 | 值 | 备注 |
|---|---|---|
| 客户/网站 owner | Jason Wong | 2026-08-21 PM 确认（此前口头误传"Jason Wang"，已更正，与网站结构化数据一致） |
| 联系邮箱 | 115parkhomes@gmail.com | 2026-08-20 PM 提供 |

网站页脚公开署名为 "Roman Hu · Ray White Mission Bay"，是网站上展示的销售代理联系方式，**不是** Magic Engine 对接的客户本人邮箱，两者不要混用。

## 站点信息

- 域名：parkhomes.nz（+ www.parkhomes.nz）
- 源码：本仓库 `docs/clients/parkhomes/web/`（Astro 项目）
- 部署：Cloudflare Pages 项目 `parkhomes-site`，账号 `Bigbigraydeng@gmail.com's Account`（Account ID `bbd84393da8e5707ba617749dc17117c`）
- DNS：2026-08-19/20 完成从第三方 Cloudflare 账号迁移到上述 ME 自管账号（原 nameserver `elijah`/`tara.ns.cloudflare.com` → 现 `eva`/`guss.ns.cloudflare.com`）
- 线索表单提交到：`https://app.magicengine.com.au/api/clients/19e025b7-555b-44fd-ba87-debc62a447a7/leads`（`[slug].astro` 里硬编码的 client_id，即生产 Supabase `clients` 表里这个客户的 UUID）

## 备注

此文件是 docs 层面的客户联系记录（当前会话未能连接到生产 Supabase `clients` 表，无法直接写库；上面那条 client_id 是从网站源码里读到的，可用它去核对生产库里的记录）。若后续确认了生产库连接方式，应把联系人信息同步补录进 `clients` 表，并以数据库记录为准。
