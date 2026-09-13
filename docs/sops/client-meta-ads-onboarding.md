# SOP — 新客户 Meta 广告户开通与授权（通用路径）

> **目的**：任何新客户要把 Meta（Facebook/Instagram）广告户交给 Magic Engine 代管/代投时，都走这一条路径，不因客户不同而另起一套流程。
> **执行人**：客户方 / 客户方所在的 PM（必须是该广告户的 Business Manager 管理员本人操作，ME 不能代做——这是 Meta 官方要求，授权必须由账户所有者亲自完成）
> **耗时**：15-20 分钟
> **前置**：操作人已经是目标客户 Business Manager 的 Admin

本文档取代 `meta-system-user-token-setup.md` 里 CTS / Oztop 专属的部分，作为**所有新客户默认路径**。CTS / Oztop 已经配好的不用重做，新客户（例如 Magic Picks）从这里开始。

---

## 零、最容易踩的坑：不要新建应用，复用 Magic Engine 已有的那一个

**2026-09-13 Magic Picks 接入时的真实教训**：agent 一开始建议给新客户单独建一个 Meta Developer App，被 PM 当场纠正——Magic Engine 应该像所有正规代投代理商一样，**所有客户共用同一个应用**，只是这个应用被逐个客户的 Business Manager 单独授权。新建应用是错的，会导致每个客户一套配置、日后维护成本线性增长，也不符合"一个 agency 一个 App，多客户挂载"的 Meta 官方推荐架构。

**Magic Engine 现有的正式应用**（用浏览器登录 developers.facebook.com/apps 核实过，2026-09-13）：

| 应用名称 | 应用编号（App ID） | 状态 | 归属业务实体 |
|---|---|---|---|
| **Magic Engine** | `1752513682785923` | 已上线 | Magic Engine |

> 同名还有一个「开发中」的 `3955651258064982`，不归属任何业务实体，那是测试用的，**不要用**。生产客户一律用已上线的 `1752513682785923`。

新客户走到"添加应用"这一步时，**按名称搜索 `Magic Engine`，选应用编号 `1752513682785923` 那个，不要点"创建应用"**。

---

## 一、进 Business Settings

1. 打开 https://business.facebook.com
2. 顶部切到客户自己的 Business Manager（不是 Magic Engine 自己的）
3. 左下角 **⚙️ 业务设置**

## 二、把 Magic Engine 应用加进这个业务账户（如果还没加过）

1. 左侧「账户」→「应用」→「添加」
2. 按名称搜索 `Magic Engine`，选应用编号 `1752513682785923`
3. 确认添加

> 如果这一步找不到、或者提示权限不够，说明客户的 Business Manager 从没跟 Magic Engine 有过关联——正常，继续走，不影响后面创建系统用户。

## 三、新建系统用户

1. 左侧「用户」→「系统用户」→右上角「+ 添加」
2. 名称填：`Magic Engine Ads`
3. 角色选：**管理员**（⚠️ 不能选"员工"，员工权限调不了 `ads_management`）
4. 创建

## 四、分配资产（不分配，令牌就是空壳）

在系统用户详情页 →「已分配的资产」→「添加资产」，以下都勾**完全控制**：

| 资产类型 | 选哪个 |
|---|---|
| **广告账户** | 客户的广告户（新客户如果还没开广告户，先在「账户」→「广告账户」里新建一个） |
| **公共主页** | 客户的 Facebook 主页 |
| **Pixel**（如果客户网站装了追踪代码） | 客户的 Pixel |

## 五、生成令牌

1. 系统用户详情页 → 右上角「生成新令牌」
2. **应用**：选 `Magic Engine`（`1752513682785923`）
3. **到期时间**：选 **永不过期**
4. **权限**（六项全勾）：
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
   - `pages_show_list`
   - `read_insights`
5. 生成 →立即复制（页面一关就再也看不到，只能重新生成）

## 六、令牌怎么给到 Magic Engine —— 绝不能贴在对话框/邮件/Slack 里

那串以 `EAA` 开头的字符能直接操控客户的广告户，泄露了任何人都能拿去投放花钱。正确路径：

1. 登进 Render Dashboard → Magic Engine 主服务 → **Environment**
2. 新增一条环境变量，命名规则：`META_SYSTEM_USER_TOKEN_<客户简称大写>`（例：`META_SYSTEM_USER_TOKEN_MAGICPICKS`）
3. 值填那串令牌
4. 保存，等 Render 自动重启（约 60 秒）

配完只需要回来说一句「token 已配」，不需要（也不应该）把令牌本身发过来。

## 七、把广告户登记进数据库

拿到广告户 ID（`act_` 开头一串数字，广告户设置首页能看到）后，登记进 `client_meta_ad_accounts` 表（每个客户可以有多个广告户，`is_primary` 标记主账户）：

```sql
INSERT INTO client_meta_ad_accounts (client_id, ad_account_id, label, is_primary)
VALUES ('<clients.id>', 'act_XXXXXXXXX', '<客户名> 主广告户', true);
```

## 八、验证（三项都过，才算真的能跑）

1. **健康 check**：调 `/me?fields=id,name`，看令牌有没有效
2. **广告户访问 check**：调 `/act_XXXXXXXXX/insights`，看能不能拿到数据
3. **写 check**：尝试建一个 `status=PAUSED` 的测试广告系列，看权限够不够写

三项都过 = 这个客户的 Meta 战线正式可跑。

---

## 常见问题

**Q1：系统用户角色选"员工"行不行？**
A：不行，员工调不了 `ads_management`，只能读不能写。

**Q2：要不要每个客户都建一个新应用？**
A：**不要**。见本文档「零」——所有客户共用 `Magic Engine`（`1752513682785923`）这一个应用。

**Q3：令牌真的永不过期？**
A：是，前提是①选了"永不过期"②用的是系统用户不是普通用户。如果客户的 Business Manager 管理员把这个系统用户移除或收回权限，令牌照样会失效——这不是技术问题，是客户那边的账户变动。

**Q4：客户还没有广告户 / 主页，怎么办？**
A：先在客户自己的 Business Manager 里新建（「账户」→「广告账户」/「公共主页」→「添加」），归属必须是客户自己的业务账户，不能挂在 Magic Engine 名下——见 `CLAUDE.md` 铁律 8「客户营销落地页必须建在客户自己的域名」同理，广告户/主页所有权也必须是客户的，Magic Engine 只是被授权的代管方。

---

## 关联

- 旧版（CTS / Oztop 专属，两家已配完不用重做）：[`meta-system-user-token-setup.md`](./meta-system-user-token-setup.md)
- Magic Picks 是第一个走本通用路径的客户，2026-09-13 接入中——完成后本文档补一行到下表：

| 客户 | 广告户 ID | 状态 |
|---|---|---|
| CTS | `act_2775766642787274` | ✅ 已配（走旧版 SOP） |
| Oztop | （见 `clients.meta_ad_account_id`） | ✅ 已配（走旧版 SOP） |
| Magic Picks | 待填 | 🔄 进行中 |
