# Image Generation Prompt Standards
# 图片生成提示词标准

> 管理：李白 Agent | 验收：马良 Agent  
> 适用平台：WaveSpeed Flux-dev（via Atlas Cloud）  
> 版本：v1.0（2026-06-02）

---

## 一、标准结构（必须按此顺序）

```
[主体描述] + [构图方式] + [光线/色调] + [风格关键词] + [技术规格] + [禁止项]
```

### 模板
```
{主体：人物/场景/产品描述}, {构图：角度/景别}, {光线：类型+色温}, 
{风格：2-3个风格词}, {品质词}, --ar {宽:高} --style raw
```

---

## 二、规格标准

| 用途 | 比例 | 分辨率参考 | Flux 参数 |
|------|------|-----------|---------|
| Reels 封面帧 / Stories | 9:16 | 1080×1920 | `aspect_ratio: "9:16"` |
| Instagram 方形帖 | 1:1 | 1080×1080 | `aspect_ratio: "1:1"` |
| Facebook 横幅帖 | 4:5 | 1080×1350 | `aspect_ratio: "4:5"` |
| 博客封面图 | 16:9 | 1280×720 | `aspect_ratio: "16:9"` |

---

## 三、AU/NZ 视觉风格指南

### 场景偏好
- ✅ 自然环境（海滩/丛林/城市街头/咖啡馆）
- ✅ 真实生活场景（非摆拍感）
- ✅ 多元文化人物（反映 AU/NZ 真实人口结构）
- ❌ 避免美式过度精致感（太完美的白牙/完美皮肤）
- ❌ 避免明显的英国/欧洲标志建筑

### 色调系统

| 品牌调性 | 推荐色温 | 参考描述 |
|---------|---------|---------|
| 温暖/亲切 | 5500K 日落金 | warm golden hour light, soft amber tones |
| 专业/信任 | 6500K 日光 | clean natural daylight, neutral tones |
| 清新/健康 | 7000K 海洋蓝 | bright coastal light, fresh teal accents |
| 奢华/高端 | 4000K 暖白 | soft studio lighting, muted luxury palette |

### 品质词（每张图必须含至少 3 个）
```
sharp focus, professional photography, high detail, 
natural lighting, authentic feel, 8k resolution,
photorealistic, editorial quality
```

---

## 四、禁止项（硬性规则）

```
❌ 真实人名（会触发版权/肖像权）
❌ 品牌商标/Logo（Nike/Apple/等）
❌ 版权角色（迪士尼/漫威/等）
❌ 政治人物/宗教符号
❌ 未成年人的单独特写
❌ 供应商名称（不写 "WaveSpeed" / "Flux" / "Atlas"）
```

---

## 五、客户品牌注入规则

每个客户的图片 prompt 必须注入 Master Brief 中的：
- `vi_colors`：品牌色调参考
- `vi_style_keywords`：品牌视觉风格词（2-3 个）
- `target_audience`：人物/场景的受众匹配

```typescript
// 注入示例
const visualPrompt = `
${brief.vi_style_keywords.join(', ')} aesthetic,
${sceneDescription},
color palette inspired by ${brief.vi_colors.primary},
targeting ${brief.target_audience.demographics},
${QUALITY_TOKENS}
`
```

---

## 六、Reels 封面帧专项规则

Reels 的 opening_frame_prompt 和 closing_frame_prompt 有额外约束：

```
开场帧（opening）：
- 必须有明确主体（人物/产品/场景），在帧中央偏上
- 不能太复杂（I2V 需要从这帧开始动起来）
- 推荐：人物正视镜头 or 产品特写

结束帧（closing）：
- 通常含品牌元素或 CTA 文字区域
- 色调与开场帧一致（同一视频感）
- 留白：右下角预留 Logo 空间
```

---

## 七、版本历史

| 版本 | 日期 | 变更 | 原因 |
|------|------|------|------|
| v1.0 | 2026-06-02 | 初始建立 | 李白提示词库建立 |

*下次更新：马良每月视觉趋势报告后由李白更新*
