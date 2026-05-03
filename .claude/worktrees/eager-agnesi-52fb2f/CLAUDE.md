# Magic Lab — Claude 工作指南

## 项目概述

Magiclab.com 官方网站。作为技术底座品牌的门面，展示公司服务、案例、洞察内容。静态导出部署。

## 技术栈

| 层 | 技术 |
|----|------|
| Framework | Next.js 14.1 (static export) |
| UI | React 18.2 + TypeScript 5.3 |
| Styling | TailwindCSS 3.4 + PostCSS |
| Deploy | Static hosting (output: 'export') |

## 架构约定

```
src/
├── app/           → Pages (home, about, contact, insights, services, work)
│   ├── robots.txt/route.tsx   → SEO
│   └── sitemap.xml/route.tsx  → SEO
└── components/    → UI 组件 (Hero, Navbar, Footer, Services, CaseStudies...)
```

### 组件规范
- 每个组件一个文件，放 `src/components/`
- 页面级组件放 `src/app/[page]/page.tsx`
- 共享类型定义放独立 `types.ts`
- 图片用 unoptimized（静态导出限制）

## 代码风格

- TypeScript 严格模式，禁止 `any`
- TailwindCSS classes 保持语义化分组
- 组件 props 必须有 TypeScript interface
- 文件 < 400 行

## SEO 规范

- 每个页面必须有 metadata（title, description, og tags）
- `robots.txt` 和 `sitemap.xml` 必须保持更新
- 图片必须有 alt text
- 语义化 HTML（h1-h6 层级正确）

## Agent 使用指南

| 场景 | 推荐 Agent |
|------|-----------|
| 新页面 | `code-reviewer` |
| 组件重构 | `/refactor-clean` |
| SEO 优化 | `code-reviewer` |
| 样式问题 | 直接修改 |

## 禁止事项

- 禁止引入后端依赖 — 这是纯静态站
- 禁止使用 `next/image` 优化功能（static export 不支持）
- 禁止硬编码联系信息 — 用 constants 文件

## 输出语言

所有对话用中文。
