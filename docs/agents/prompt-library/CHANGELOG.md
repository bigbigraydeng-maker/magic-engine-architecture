# Prompt Library — 变更日志

> 管理人：李白 Agent  
> 规则：每次修改任何提示词文件，必须在此追加一条记录。

---

## 格式

```
## YYYY-MM-DD [文件名] vX.Y
- 变更内容：[具体改了什么]
- 变更原因：[为什么改，来自哪个数据/反馈]
- 影响 Agent：[哪些 agent 的行为会变化]
- 验收：[马良验收 / 李白自评 / 魏征审查]
```

---

## 2026-06-02 初始化

所有提示词文件初始建立，待各 agent 代码完成后填充版本 v1.0。

待建文件：
- `seo-blog.md` ← 博客生成 system prompt
- `geo-directive.md` ← GEO 指令生成 prompt
- `social-campaign.md` ← 社媒 campaign 批量生成 prompt
- `brief-generator.md` ← Master Brief 生成 prompt
- `image-generation.md` ← 图片生成提示词标准
- `video-i2v.md` ← 视频 I2V 提示词标准（Seedance）
