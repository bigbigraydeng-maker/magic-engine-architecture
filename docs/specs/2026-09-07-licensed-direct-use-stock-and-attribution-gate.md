# Spec：授权直用素材 + 发布前署名闸（Licensed Direct-Use Stock & Attribution Gate）

- 日期：2026-09-07
- 状态：**立项草案（待 2 审：子牙架构 / 魏征挑刺；PM 已认方向）**
- 风险级：**A**（碰共享出片池 evaluate.ts + 对外发布合规 + 可能改 schema）
- 触发：给 CTS 攒了 102 张 Wikimedia CC 授权风景图，要让视频 agent 能调用；双审发现现有工厂 stock 链会**抹掉署名、把合法 CC 图做成违规成片**（见 [[feedback-factory-stock-chain-strips-credit-cc-unsafe]]）。

---

## 1. 问题（为什么要立项）

ME 工厂现有 stock 链（`stock-pipeline.ts` `ingestHarvestedImages` → `stock-ingest.ts` → `stock-transform.ts`）是为 **"抓来路不明的图 → gpt-image-1 重绘脱版权 → 只有 AI 改写后的进出片池"** 设计的。把**授权干净但要求署名**的 CC-BY/CC-BY-SA 图灌进它，四个硬点全踩（双审坐实）：

1. **原图进不了池**：`evaluate.ts` 的 `sourceImagePool` 只收 `is_ai_transformed===true`；原图 = 死数据。唯一出口是 AI 重绘（$0.04/张 + 把真实风景画成假通用画面 = PM 骂的"跑题"）。
2. **零 credit + 主动抹署名**：`HarvestedImage` 类型无 author/license；`buildStockClipRows` 硬编 `provider:'pinterest'`、不存 author/license；transform prompt 明令 `No text/watermark/signage` → 主动抹署名。全链无任何署名环节。**CC-BY/CC-BY-SA 经此链发布 = 违约。**
3. **scene_tag 是 6 词白名单**；城市/景点被静默拍平成 `establishing` → 按城市挑片失效。
4. **一 transform 就 status=active 立即上线**，无"入库暂不启用"开关 → 无署名 CC 衍生图会自动进下一条发布。

**结论**：需要一条**独立于"洗盗图"链**的「授权直用素材」通路，并补上 ME 目前**完全没有**的**发布前署名能力**。

---

## 2. 目标 / 非目标

**目标**
- G1 授权干净的图（CC/PD/客户授权）以**直用**身份进出片池，**不经 AI 重绘**。
- G2 每张图**全程携带 provenance**：license / author / source_url / origin，并可被 agent **按城市·景点·朝向查询**。
- G3 **发布前署名闸**：任何用到"需署名"素材（CC-BY/CC-BY-SA）的成片，发布前必须带上摄影者+协议 credit（endcard 或首评），否则 **fail-closed 拦发**。
- G4 与现有 Pinterest stock 链、及其清理任务（task_7c3297ff）**物理隔离**，互不误伤。
- G5 "入库暂不启用"开关：先入库、人审后才进池。

**非目标（本 spec 不含）**
- N1 **视觉 AI 自动识别打标**（自动判白天/黑夜/有没有人）——另立平台能力，单独评审。
- N2 i2v 出片本身 / Muapi 额度 / 蒙太奇引擎——出片环节，与入库分开。
- N3 竖版素材不足的补足策略——素材采集问题，非本机制。

---

## 3. 层级判定（Tier Classification · 平台层级门）

**被判定对象**：授权直用素材入库通路 + 发布前署名闸。

| 组成 | 层级 | 理由 |
|---|---|---|
| `origin='licensed_stock'` 入库通路 + evaluate 池分支 | **L1 平台能力** | client-agnostic；未来任何客户的授权图库通吃 |
| 发布前署名闸 | **L1 平台能力（Governance/合规）** | 所有客户、所有对外发布通用；属发布内核的合规闸 |
| provenance 字段（license/author/source） | **L1**（机制）+ **L4**（具体值） | 机制共享；每张图的具体授权/作者是 client-scoped 数据 |
| CTS 这 102 张 + 城市/景点标签 | **L4 客户数据** | 按 client_id 隔离，存 per-row meta |

**红线检查**：
- 红线 1（禁包装升级）✓ 不新设支柱/智能层，是发布内核合规闸 + 素材入库通路的扩展。
- 红线 2（禁客户事实进 shared runtime）✓ 城市/景点标签落 **per-row meta**，**绝不**塞进 `constants.ts` 的 scene_tag 白名单（子牙红线）。
- 红线 4/5（换客户/换行业）✓ 机制对任何客户任何行业成立；"CTS 城市"是数据不是规则。
- 换客户测试：换 Oztop/地产客户 → 同一入库通路 + 署名闸照用，只是数据不同 ✓。

**结论**：L1 平台能力（机制）+ L4 客户数据（内容）。不新增能力线。需走完整五道 Build Gate + 大任务 2 审。

---

## 4. 设计

### 4.1 入库通路（新入口，不复用 ingestHarvestedImages）
- 新函数（建议 `src/lib/factory/licensed-stock.ts`）：读每城 manifest → 下载/上传/去重（**复用** stock-pipeline 里已验证的 IO：`fileNameFor` / bucket upload / sha 去重）→ 写 `video_clips` 行。
- 存储桶前缀独立：`content-factory/licensed_stock/`（跟 `stock/`、`renders/` 分开，一眼可辨）。
- 🔴 Wikimedia 取图坑（魏征）：manifest 存**中等分辨率派生 URL**（不用 original，常 >15MB 被 `MAX_IMAGE_BYTES` 静默跳过）；只收 jpg/png（`.svg/.tif` 会被当 jpg 存坏）；**不走** `normalizeHarvest`（`minSaves=50` 会全刷掉）。

### 4.2 落库字段（video_clips）
- `track='b_generated'`、`is_still_image=true`、`is_real_footage=false`（保持"氛围底料、绝不当真拍打真价"的隔离，与现有一致）。
- **新增 provenance**（存 `source_meta` jsonb，避免 migration；若需大规模按景点查再考虑加列）：
  `{ origin:'licensed_stock', provider:'wikimedia_commons', license, license_url, author, source_url, note, requires_attribution:bool, city, landmark, orientation }`。
  🔴 `license_url`（协议链接）和 `note`（修改说明，如 "resized to 1150px wide, re-encoded JPEG q68"）**必须落库**，不能只存 license 名称——发布闸最终要拼出完整 CC 署名（作者 + 协议 + 协议链接 + 是否修改），少一项署名就不完整。现有 `templates/tailor-made-itinerary/heroes/CREDITS.json` 已经在存这两项，入库时原样带过来，不要再重新调查。
- **`requires_attribution` 判定必须先规范化再比对，不能直接对原始字符串做集合成员判断**：Wikimedia 实际值带空格和版本号（`CC BY 2.0`、`CC BY-SA 3.0`、`CC BY-SA 4.0`，见上面 CREDITS.json 的真实样本），逐字比 `license ∈ {'CC-BY','CC-BY-SA'}` 会全部判不中导致误判为无需署名，署名闸形同虚设。改为：
  1. 解析出受控的 `license_family`（`CC-BY` / `CC-BY-SA` / `CC0` / `PUBLIC_DOMAIN`）+ `license_version`，只认白名单模式（如 `/^CC[- ]BY(-SA)?[- ]?\d+(\.\d+)?$/i` 加归一化空格/连字符）；
  2. `license_family ∈ {CC-BY, CC-BY-SA}` → `requires_attribution=true`；`∈ {CC0, PUBLIC_DOMAIN}` → `false`；
  3. **无法归一化解析的原始 license 字符串一律 fail-closed**：`requires_attribution=true` 且该行禁止进入 4.3 的直用分支，直到人工修正 license 字段为受控值——不允许"未知值默认不需要署名"。
- **不碰** scene_tag 白名单：scene_tag 走既有兜底即可；**景点查询靠 source_meta.landmark**（需给 strategist 挑片逻辑加读 source_meta.landmark 的分支，或 evaluate 侧带出）。

### 4.3 进池（evaluate.ts sourceImagePool）
- 新增分支：`origin='licensed_stock'` 且 `status='active'` **且 `source_meta.requires_attribution===false`** 的行**直接进** sourceImagePool（对标 `client-asset-pool.ts` 的"直用不改写"），**不要求** `is_ai_transformed`。
- 🔴 **`requires_attribution=false` 是查询层硬条件，不是靠人审流程去把关**：只检查 `origin` + `status` 不够——人审只要把一张 CC-BY/CC-BY-SA 图设成 `active`，它就会在 P3 署名闸落地前直接进池，跟第 94 行"P3 通过前一张都不许进池"的边界矛盾。`requires_attribution=true` 的行即使 `status='active'` 也必须被这条查询排除，直到 P3 署名闸上线并验证通过后，才把这个条件放宽为"闸存在则放行、闸不存在则拦"。
- 与 Pinterest 链彻底分开：licensed_stock **永不**进 `transformStockImages`（不重绘、不脱版权，本来就干净）。

### 4.4 🔴 发布前署名闸（本 spec 的核心新能力）
- **provenance 传递**：工单要记录它用了哪些 source 图（image_asset → work_order），把 `requires_attribution` 的图的 author/license/license_url/note 汇总带到发布层（4.2 的 `source_meta` 全字段一起带，不能只带 author + license 名称——闸要能拼出完整 CC 署名：作者 + 协议 + 协议链接 + 修改说明）。
- **闸**：`publish-worker` 发布前检查——若本片用到任一 `requires_attribution=true` 的图，则**成片 caption 或 endcard 文案必须含**对应摄影者 + 协议名 + 协议链接（+ 有修改则注明"modified"）；缺任一项 = **fail-closed 拦发**（比照现有红线闸 `scanPublishCaption` 的 fail-closed 写法，闸校验的是最终署名文本内容，不是"有没有填 credit 字段"）。
- 🔴 **credit 载体只能是发布前可校验的位置（caption / endcard），本期不做"首评"**：现有 `publish-worker.ts`（`src/lib/factory/publish/publish-worker.ts:254-255`）发布调用只传 `videoUrl` + `caption`，没有首评步骤；首评通常要先拿到已发布帖子 ID 才能创建，等于帖子先公开、评论后补。若评论请求失败，就会留下一条已公开但无署名的内容，不满足 fail-closed。因此本期署名闸**只接受 caption/endcard 这类发布前即可读取校验的字段**；"先建不可见草稿 → 写首评拿到回执 → 再公开"的分阶段发布工作流留作后续能力，需要 provider 支持隐藏发布 + 独立立项评估，本 spec 不含。
- CC0/PD 图不触发此闸。
- SA（ShareAlike）注记：i2v 衍生是否触发 SA 的"同协议"义务需法务确认；**保守起见 licensed_stock 一期只走"直用/蒙太奇"，CC-BY-SA 图先不喂 i2v 重构**（重绘=衍生，SA 风险高）。

### 4.5 启用开关 + 隔离
- 入库默认 `status='quarantined'`（新入库暂不进池），人审后置 `active`（堵魏征"一入库就自动上线"）。
- 与 task_7c3297ff（Pinterest 清理）对齐：清理判据必须按 `origin`/`provider` 精确匹配，**licensed_stock 不在清理范围**——立项后先跟那个窗口对齐判据再上线。

---

## 5. 分期（严格顺序：署名闸必须先于任何 CC-BY 图对外）

- **P1**：入库通路 + provenance 落库 + quarantine 开关 + origin 隔离。产物：图安全进库、可查、**inert（不进池、不发布）**。
- **P2**：evaluate `licensed_stock` 直用分支 + strategist 按 landmark 挑片。查询条件**代码层强制** `requires_attribution=false`（见 4.3），不依赖人审自觉。产物：CC0/PD 图可进池喂出片；CC-BY/CC-BY-SA 图即使 `status='active'` 仍被查询排除，物理上进不了池。
- **P3**：发布前署名闸（fail-closed）。P3 落地并验证通过后，才把 4.3 的 `requires_attribution=false` 条件放宽为"闸存在则按闸结果放行"。**在此之前，CC-BY/CC-BY-SA 图一张都不许进出片池/发布**；只有 CC0/PD 可先用。

---

## 6. 数据 / RLS
- 复用 `video_clips`，不新建表 → 无新 RLS。
- 若后续为"按景点大规模查询"加列，另起 migration（service_role 模板，见 DECISIONS），本 spec 一期不加列。

---

## 7. 风险 / fail-closed
- 署名闸**必须 fail-closed**：查不到 credit / 查询出错 → 拦发（合规违约是不可逆对外风险，宁可不发）。
- quarantine 默认关：防未审素材自动上线。
- origin 物理隔离：防 Pinterest 清理误删 + 防混淆。

---

## 8. Reuse Statement
- **复用**：stock-pipeline 的下载/上传/去重 IO；client-asset-pool 的"直用不改写"范式；publish-worker 红线闸的 fail-closed 写法。
- **新增 platform-shared**：`origin='licensed_stock'` 通路 + evaluate 池分支 + **发布前署名闸**（发布内核合规能力，全客户通用）。
- **client-specific**：CTS 102 张 + 城市/景点/授权/作者（per-row meta，client_id 隔离）。
- **未**将任何客户城市语义写入共享常量（scene_tag 白名单原封不动）。
- 落点与 tier 判定一致：机制在 shared runtime，客户事实在 per-row。

---

## 9. 待办 / 立项后下一步
1. 2 审：子牙（架构，尤其 evaluate 分支与 client-asset-pool 对齐）+ 魏征（挑刺，尤其署名闸 fail-closed 与 provenance 传递）。
2. 跟 task_7c3297ff 窗口对齐 Pinterest 清理判据。
3. 法务/PM 确认：i2v 重绘对 CC-BY-SA 的 SA 义务边界（决定 CC-BY-SA 是否允许喂 i2v）。
4. 走五道 Build Gate → 分期实现（P1→P2→P3）。
