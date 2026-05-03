# Cursor 任务：创建 Agent Pro 骨架模板

## 目标
创建一个新的骨架模板 `agent-pro`，基于 3 个新西兰顶级房地产经纪人网站的设计模式。

## 参考网站分析

### 1. David Ding (davidding.co.nz)
- **设计要点**：深蓝色 (#001c48) + 橙色 (#fb8e28)
- **关键模块**：
  - Hero：经纪人品牌 + 统计数据（已售数、Google评星、从业年限）
  - Listings：房源网格卡片（卧室/浴室/车位）
  - Achievements：8个核心优势点
  - Testimonials：客户成功案例
  - Awards：获奖认证展示
  - Footer：联系信息与社交媒体

### 2. Drew Miller (drewmiller.co.nz)
- **设计要点**：简洁单列，白色背景，蓝色链接
- **关键模块**：
  - Hero：估价表单（"想要出售房产？"）
  - Market Intro：市场介绍
  - Newsletter：邮件订阅
  - About Agent：经纪人背景
  - Testimonials：客户推荐
  - Recent Sales：最近成交展示

### 3. Mike Robson (mikerobson.co.nz)
- **设计要点**：明黄色 (#FCE620) + 炭灰 (#57585A)，优雅衬线字体 Playfair Display
- **关键模块**：
  - Hero + About：品牌与简介
  - Stats Counter：**动画数字计数器**（多年经验、满意客户、已售房产数）
  - Portfolio：作品集/房源列表
  - Testimonials：客户评价
  - Case Studies：案例研究
  - Contact Slider：右侧滑出式联系表单

## 创建任务

### 步骤 1：验证类型系统
1. 打开 `src/types/skeleton.ts`，确认支持的 ModuleType 列表
2. 打开 `src/data/skeletons/classic-agent.ts` 和 `property-showcase.ts`，理解 modules 和 variant 的格式

### 步骤 2：创建新骨架模板文件
**文件路径**：`src/data/skeletons/agent-pro.ts`

**模板结构**：

```typescript
import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_AGENT_PRO: TemplateSkeleton = {
  id: "agent-pro",
  name: "专业经纪人",
  nameEn: "Agent Pro",
  industry: "real_estate",
  description: "参考顶级经纪人网站设计，突出业绩数据、房源展示与客户评价",
  thumbnail: "/skeletons/agent-pro.png",
  modules: [
    // 1. Hero：经纪人品牌 + 背景
    { type: "hero", variant: "agent-brand", visible: true },

    // 2. Offer/Stats：**动画统计数据**（已售数、客户满意度、从业年限）
    // 根据实际 variant 名称，可能是 "stats-counter" 或 "achievements"
    { type: "offer", variant: "stats-counter", visible: true },

    // 3. Listings：房源网格
    { type: "listings", variant: "card-grid", visible: true },

    // 4. Services/Features：核心优势（8个点）
    // 如果 services 不支持，可用 features
    { type: "services", variant: "icon-grid", visible: true },

    // 5. Testimonials：客户推荐
    { type: "testimonials", variant: "quote-cards", visible: true },

    // 6. About：经纪人故事
    { type: "about", variant: "side-by-side", visible: true },

    // 7. FAQ：常见问题
    { type: "faq", variant: "accordion", visible: true },

    // 8. Form：表单（留线索）
    { type: "form", variant: "default", visible: true },

    // 9. Contact：联系方式
    { type: "contact", variant: "full-channels", visible: true },

    // 10. Footer：页脚
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#001c48",  // David Ding 的深蓝色
    accent: "#fb8e28",   // David Ding 的橙色
    background: "#ffffff",
    fontFamily: "inter",
    palettes: [
      {
        id: "deep-blue-orange",
        name: "深蓝橙",
        primary: "#001c48",
        accent: "#fb8e28",
        background: "#ffffff"
      },
      {
        id: "yellow-charcoal",
        name: "明黄炭灰",
        primary: "#57585A",
        accent: "#FCE620",
        background: "#ffffff"
      },
      {
        id: "forest-gold",
        name: "森林金",
        primary: "#1a4731",
        accent: "#d4a853",
        background: "#f9f7f2"
      }
    ]
  },
  defaultFormTemplate: "property_appraisal"
};
```

### 步骤 3：注册到骨架索引

1. 打开 `src/data/skeletons/index.ts`
2. 在顶部添加导入：
   ```typescript
   import { SKELETON_AGENT_PRO } from "./agent-pro";
   ```
3. 在 `ALL_SKELETONS` 或 `TEMPLATES` 数组中添加 `SKELETON_AGENT_PRO`

### 步骤 4：问题排查

如果遇到以下错误，按以下方式处理：

| 错误 | 解决方案 |
|------|--------|
| `variant: "stats-counter"` 不存在 | 查看 classic-agent.ts，找实际使用的 variant 名称，或改为 "achievements" |
| `type: "services"` 不支持 | 查 types/skeleton.ts，用支持的 ModuleType（可能是 "features" 或其他） |
| `type: "offer"` 不支持 | 改为 "achievements" 或直接删除，stats 通常在 hero variant 中实现 |
| 注册失败 | 确保 ALL_SKELETONS 是数组，所有导入正确 |

### 步骤 5：验证

运行构建验证：
```bash
npm run build
```

确保无 TypeScript 错误。

## 关键设计理念

1. **图片为核心**：Agent Pro 模板应该在 hero 和 listings 中充分利用高质量图片
2. **数据透明**：统计数据（已售数、客户评分、从业年限）是信任建立的关键
3. **行动号召（CTA）**：明显的"评估房产价格"按钮，可由表单驱动
4. **移动友好**：所有模块响应式设计，mobile-first

## 完成标志

✓ 文件 `src/data/skeletons/agent-pro.ts` 创建完成
✓ 在 `src/data/skeletons/index.ts` 中注册
✓ `npm run build` 无错误
✓ TypeScript 类型检查通过

---

**提交**：完成后回复 "✅ Agent Pro 模板创建完成" + 可选的问题或错误信息。
