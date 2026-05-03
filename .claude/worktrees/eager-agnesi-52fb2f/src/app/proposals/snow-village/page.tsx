import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Snow Village – 数字化增长全案 | Magic Lab',
  description: '网站重建 · SEO搜索优化 · 社媒内容运营，助力 Snow Village 成为新西兰商用制冷设备第一品牌',
  robots: 'noindex, nofollow',
};

export default function SnowVillageProposal() {
  return (
    <div className="min-h-screen bg-white pt-16">

      {/* COVER */}
      <div className="relative overflow-hidden text-white" style={{ background: 'linear-gradient(135deg, #000000 0%, #0a2540 50%, #004e7c 100%)' }}>
        {/* Logo 大图水印背景 */}
        <div
          className="absolute inset-0 pointer-events-none select-none"
          style={{
            backgroundImage: 'url(/images/snow-village/logo.svg)',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center 75%',
            backgroundSize: '110% auto',
            opacity: 0.18,
          }}
          aria-hidden="true"
        />
        {/* 渐变遮罩，让 logo 自然融入 + 保证文字可读 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.6) 100%)' }}
          aria-hidden="true"
        />
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #00b4d8 0%, transparent 70%)', transform: 'translate(80px, -80px)' }} />
        <div className="max-w-4xl mx-auto px-8 py-20 relative">
          <div className="inline-block bg-cyan-500/30 border border-cyan-400/60 text-cyan-300 text-xs tracking-widest px-4 py-1 rounded-full mb-8 font-medium uppercase backdrop-blur-sm">
            商业合作提案 · 保密文件
          </div>
          <h1 className="text-5xl font-bold leading-tight mb-4" style={{ fontFamily: 'serif', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
            Snow Village<br />
            <span className="text-cyan-300">数字化增长全案</span>
          </h1>
          <p className="text-white/70 text-base mb-12 max-w-xl">
            网站重建 · SEO搜索优化 · 社媒内容运营<br />
            助力 Snow Village 成为新西兰商用制冷设备第一品牌
          </p>
          <div className="flex flex-wrap gap-10 text-sm text-white/55">
            <div><strong className="block text-white/90 text-sm mb-1">提案方</strong>Magic Lab</div>
            <div><strong className="block text-white/90 text-sm mb-1">提案对象</strong>Snow Village NZ</div>
            <div><strong className="block text-white/90 text-sm mb-1">日期</strong>2025年</div>
            <div><strong className="block text-white/90 text-sm mb-1">有效期</strong>30天</div>
          </div>
        </div>
      </div>

      {/* 01 现状诊断 */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="01" label="现状诊断" />
        <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>我们看到的问题</h2>
        <p className="text-slate-600 mb-8">
          Snow Village 拥有优质的产品线与真实的市场需求，但当前的数字化能力严重制约了业务增长。以下四个核心痛点是本次合作的出发点：
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { icon: '🔴', title: '网站体验极差', desc: '现有网站基于老旧平台搭建，加载缓慢、移动端体验差、产品展示混乱，导致大量潜在客户在第一眼就流失。' },
            { icon: '🔴', title: 'SEO 几乎为零', desc: '搜索"commercial fridge Auckland"、"商用冰柜新西兰"等关键词，Snow Village 几乎不出现在首页，每天损失大量免费精准流量。' },
            { icon: '🔴', title: '社媒有人发、无人营', desc: '团队有3位全职员工做 Facebook 内容发布，但缺乏系统的内容策略和运营框架，内容曝光率低、转化弱。' },
            { icon: '🔴', title: '多平台空白', desc: 'TikTok、Instagram 等年轻采购决策者高度活跃的平台完全缺席，竞争对手正在这些渠道快速积累品牌影响力。' },
          ].map((item) => (
            <div key={item.title} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm" style={{ borderLeft: '4px solid #ef4444' }}>
              <h4 className="font-bold text-slate-900 mb-2">{item.icon} {item.title}</h4>
              <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 02 解决方案 */}
      <section className="bg-slate-50">
        <div className="max-w-4xl mx-auto px-8 py-16">
          <SectionLabel num="02" label="解决方案" />
          <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>我们的三步走方案</h2>
          <p className="text-slate-600 mb-8">
            我们将在 <strong className="text-slate-900">2周内完成新网站上线</strong>，同步启动 SEO 与社媒运营，形成"建站即引流、内容即销售"的完整闭环。
          </p>
          <div className="space-y-6">
            {[
              { num: '1', phase: '第 1–2 周', title: '新网站上线（Shopify）', desc: '采用 Shopify 专业主题，对标行业标杆视觉水准。完成150+ SKU 产品迁移、分类结构搭建、支付与物流配置。2周内完成交付，客户团队可即刻自主管理后台。' },
              { num: '2', phase: '第 1 个月起', title: 'SEO 系统化布局', desc: '每月产出 20 个经过关键词研究的优化页面，覆盖产品类目、行业场景（餐厅/咖啡店/超市/加油站）、地区落地页（Auckland/Wellington/Christchurch）三大维度，12个月内稳步占领本地搜索首页。' },
              { num: '3', phase: '第 1 个月起', title: '社媒内容矩阵（FB + TK + IG）', desc: '每月 100 条内容（基准，最多 200 条），其中 60% 为视频内容，涵盖数字人讲解视频（HeyGen）、产品展示短视频（闪剪）、促销图文、客户案例等多种形式，全面覆盖 Facebook、TikTok、Instagram 三大平台。' },
            ].map((step) => (
              <div key={step.num} className="flex gap-5">
                <div className="w-10 h-10 rounded-full bg-cyan-700 text-white font-bold text-sm flex items-center justify-center flex-shrink-0 mt-1">{step.num}</div>
                <div>
                  <span className="inline-block bg-cyan-100 text-cyan-700 text-xs font-bold px-2 py-1 rounded mb-2">{step.phase}</span>
                  <h4 className="font-bold text-slate-900 mb-1">{step.title}</h4>
                  <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 03 服务详情 */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="03" label="服务详情" />
        <h2 className="text-3xl font-bold text-slate-900 mb-8" style={{ fontFamily: 'serif' }}>我们具体做什么</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {([
            {
              icon: '🌐', title: '网站建设',
              items: ['Shopify 专业主题定制', '150+ SKU 产品迁移与优化', 'Mega Menu 导航系统', '移动端全面适配', '报价询价功能集成', '支付 / 物流配置', '基础 SEO 架构搭建', '2周内交付上线'],
              note: null,
            },
            {
              icon: '🔍', title: 'SEO 优化',
              items: ['50个目标关键词追踪', '20个新优化页面 / 月', '产品页 · 场景页 · 地区页', 'Google Search Console 管理', 'SEO 实时预警系统', '每月完整排名报告', '技术SEO持续优化', '内链建设 · 外链拓展'],
              note: null,
            },
            {
              icon: '📱', title: '社媒运营',
              items: ['100条/月（基准），最多200条', '其中 60% 为视频内容', 'Facebook + TikTok + Instagram', '数字人产品讲解视频', '产品展示短视频剪辑', '促销活动内容策划', '客户案例故事化制作', '每月数据分析报告'],
              note: '广告投流费用不含，按目标关键词 CPC 实测后另列预算，Magic Lab 不收任何代投手续费',
            },
          ] as const).map((svc) => (
            <div key={svc.title} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 to-blue-600" />
              <div className="text-3xl mb-3">{svc.icon}</div>
              <h4 className="font-bold text-slate-900 mb-4">{svc.title}</h4>
              <ul className="space-y-2">
                {svc.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-slate-500">
                    <span className="text-cyan-500 font-bold flex-shrink-0 mt-0.5">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              {svc.note && (
                <p className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
                  💡 {svc.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 04 SEO 策略 */}
      <section className="bg-slate-50">
        <div className="max-w-4xl mx-auto px-8 py-16">
          <SectionLabel num="04" label="SEO 策略" />
          <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>12个月 SEO 内容规划</h2>
          <p className="text-slate-600 mb-8">针对 Snow Village 的产品特性与目标客群，我们将 SEO 内容分三个阶段推进，确保每一篇内容都有真实的搜索需求支撑。</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                phase: '第 1–2 月 · 地基',
                rows: [['产品类目优化页', '8页'], ['行业场景落地页', '6页'], ['地区覆盖页', '4页'], ['品牌核心页', '2页']],
              },
              {
                phase: '第 3–6 月 · 扩张',
                rows: [['长尾产品对比页', '6页'], ['采购指南 / 博客', '8页'], ['FAQ 知识库页', '4页'], ['竞品比较页', '2页']],
              },
              {
                phase: '第 7–12 月 · 权威',
                rows: [['深度行业报告', '4页'], ['客户案例页面', '6页'], ['季节性内容', '6页'], ['视频 SEO 页', '4页']],
              },
            ].map((col) => (
              <div key={col.phase} className="bg-white border border-slate-200 rounded-xl p-5">
                <h4 className="text-xs font-bold text-cyan-700 uppercase tracking-wider mb-4">{col.phase}</h4>
                {col.rows.map(([label, val]) => (
                  <div key={label} className="flex justify-between text-sm py-2 border-b border-slate-100 last:border-b-0">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-bold text-slate-900">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm pt-3 font-bold text-cyan-700">
                  <span>合计</span><span>20页/月</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-slate-400">
            💡 目标关键词示例：commercial fridge Auckland · display fridge NZ · 商用冰柜新西兰 · cafe refrigerator supplier · upright freezer hospitality NZ
          </p>
        </div>
      </section>

      {/* 05 竞品分析 */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="05" label="竞品分析" />
        <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>市场机会：竞争对手的数字化短板</h2>
        <p className="text-slate-600 mb-8">
          我们对 NZ 本地主要商用制冷设备供应商进行了数字化能力扫描，结论是：<strong className="text-slate-900">这个行业整体数字化程度偏低，先动者优势显著。</strong>
        </p>
        {/* 竞品网站截图 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          {competitorSites.map((comp) => (
            <div key={comp.name} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="relative bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={comp.screenshot}
                  alt={`${comp.name} 网站截图`}
                  className="w-full h-44 object-cover object-top"
                  loading="lazy"
                />
                <span className={`absolute top-3 right-3 text-xs font-bold px-2 py-1 rounded shadow-sm ${comp.ratingColor}`}>
                  网站质量：{comp.rating}
                </span>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-bold text-slate-900">{comp.name}</h4>
                  <a href={comp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline">
                    访问网站 →
                  </a>
                </div>
                <p className="text-xs text-slate-500">{comp.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 竞品对比表格 */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white">
                {['竞争对手', '网站质量', 'SEO', '社媒运营', 'TikTok', '在线购买'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-xs tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Southern Hospitality', '较好', '⚠️ 一般', '⚠️ 基础', '✗ 无', '✓ 有'],
                ['Simco Catering', '一般', '⚠️ 较弱', '⚠️ 偶发', '✗ 无', '✓ 有'],
                ['Flocon NZ', '较差', '✗ 极弱', '✗ 几乎无', '✗ 无', '✗ 无'],
                ['Chilled Status', '一般', '✗ 弱', '✗ 无策略', '✗ 无', '✗ 无'],
              ].map((row, i) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                  {row.map((cell, j) => (
                    <td key={j} className={`px-4 py-3 text-slate-600 ${cell.startsWith('✓') ? 'text-emerald-600 font-semibold' : ''} ${cell.startsWith('✗') ? 'text-slate-400' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
              <tr className="bg-cyan-50 font-semibold">
                {['Snow Village（合作后）', '🏆 行业最优', '✅ 系统化', '✅ 全平台', '✅ 首家', '✅ 完整'].map((cell, j) => (
                  <td key={j} className="px-4 py-3 text-slate-900">{cell}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 06 定价 */}
      <section className="bg-slate-50">
        <div className="max-w-4xl mx-auto px-8 py-16">
          <SectionLabel num="06" label="合作定价" />
          <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>专属报价方案 · 3 个月合同起</h2>
          <p className="text-slate-600 mb-8">
            以下为针对 Snow Village 定制的战略合作价格，<strong className="text-slate-900">较市场标准价格享受 40% 优惠</strong>，换取深度长期合作与案例授权。<strong className="text-slate-900">月度服务费已包含全部工具与系统成本</strong>，客户仅需另付 Shopify 自身费用。
          </p>

          {/* 主定价卡 */}
          <div className="relative overflow-hidden text-white rounded-2xl p-10 mb-5" style={{ background: 'linear-gradient(135deg, #0a2540, #1a4060)' }}>
            <div className="absolute right-8 bottom-0 text-8xl opacity-5 leading-none select-none">❄</div>
            <div className="inline-block bg-amber-400 text-slate-900 text-xs font-bold px-3 py-1 rounded mb-6 tracking-wide uppercase">
              🌟 GROWTH 全包套餐 · 3 个月合同
            </div>

            <div className="flex justify-between items-start py-5 border-b border-white/10">
              <div>
                <div className="font-semibold text-white/90 mb-1">一次性建站费</div>
                <div className="text-xs text-white/50">Shopify 建站 + 150 SKU 迁移 + 主题定制 + 基础SEO架构</div>
              </div>
              <div className="text-right flex-shrink-0 ml-8">
                <div className="text-xs text-white/35 line-through mb-1">市价 $8,000</div>
                <div className="text-4xl font-bold">$4,800</div>
                <div className="text-xs text-white/50 mt-1">一次性 · +GST</div>
              </div>
            </div>

            <div className="flex justify-between items-start py-5 border-b border-white/10">
              <div>
                <div className="font-semibold text-white/90 mb-1">月度服务费 · 全包</div>
                <div className="text-xs text-white/50">SEO（20页/月）+ 社媒运营（100条基准 / 60% 视频）+ 月度报告 + 下方所有工具栈月费</div>
              </div>
              <div className="text-right flex-shrink-0 ml-8">
                <div className="text-xs text-white/35 line-through mb-1">市价 $5,500/月</div>
                <div className="text-4xl font-bold">$3,300</div>
                <div className="text-xs text-white/50 mt-1">/月 · +GST · 3个月起</div>
              </div>
            </div>

            {/* 全包工具栈 */}
            <div className="py-5 border-b border-white/10">
              <div className="font-semibold text-white/90 mb-3 flex items-center gap-2">
                <span className="text-emerald-400">✓</span> Magic Lab 全包（无需另付）
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs text-white/70">
                {[
                  'Cloudflare CDN & 安全',
                  'Cloudflare 企业邮箱',
                  'Render 应用托管',
                  'Supabase 数据库',
                  'Publer 多平台发布',
                  'Zapier 自动化',
                  'Airtable CRM',
                  'Lovart 设计 AI',
                  'HeyGen 数字人视频',
                ].map((tool) => (
                  <div key={tool} className="flex items-start gap-1.5">
                    <span className="text-cyan-300 flex-shrink-0">·</span>
                    {tool}
                  </div>
                ))}
              </div>
            </div>

            {/* Pass-through Shopify */}
            <div className="py-5">
              <div className="font-semibold text-white/90 mb-3 flex items-center gap-2">
                <span className="text-amber-400">⚠</span> 客户单独支付（按 Shopify 实际收费）
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="text-white/90 font-medium">Shopify 主题模板</div>
                  <div className="text-white/50">一次性 · 约 NZD $400（按选定主题）</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="text-white/90 font-medium">Shopify 月费</div>
                  <div className="text-white/50">Basic Plan · 约 NZD $66/月</div>
                </div>
              </div>
            </div>
          </div>

          {/* 限时礼包 */}
          <div className="relative overflow-hidden rounded-2xl p-7 mb-5" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '1px solid #f59e0b' }}>
            <div className="absolute right-6 top-6 text-5xl opacity-20 leading-none select-none">🎁</div>
            <div className="inline-block bg-amber-600 text-white text-xs font-bold px-3 py-1 rounded mb-3 tracking-wide uppercase">
              限时礼包 · 仅本提案有效
            </div>
            <h4 className="text-xl font-bold text-amber-900 mb-2">💎 AI 技能训练营 × 3 席位</h4>
            <p className="text-sm text-amber-900/80 leading-relaxed">
              签约即赠 Magic Lab AI 技能训练营 3 个席位，<strong>价值 NZD $5,980</strong>。覆盖 ChatGPT 商用、AI 内容生产、AI 数据分析等模块，帮助 Snow Village 团队建立内部 AI 能力，长期受益。
            </p>
          </div>

          {/* 超出费用 */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: '超出内容条数', price: '$10 / 条' },
              { label: '超出SEO页面', price: '$200 / 页' },
            ].map((item) => (
              <div key={item.label} className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex justify-between items-center shadow-sm">
                <span className="text-sm text-slate-500">{item.label}</span>
                <span className="text-lg font-bold text-slate-900">{item.price}</span>
              </div>
            ))}
          </div>

          <p className="mt-5 text-xs text-slate-400">
            💡 所有费用均不含 GST。月度服务费按 3 个月合同期收取，到期可续约。
          </p>
        </div>
      </section>

      {/* 06+ 价值对比 */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="06+" label="价值对比" />
        <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>同样的工作，市场价 vs Magic Lab</h2>
        <p className="text-slate-600 mb-10">
          以下对比基于 Snow Village 完整方案范围（建站 + 12 个月 SEO + 12 个月社媒 + AI 培训 + 全部工具栈），
          按 NZ 本地市场标准价格逐项核算。<strong className="text-slate-900">两组数字不仅展示费用差距，更体现 Magic Lab AI 增长引擎在交付效率上的代际差异。</strong>
        </p>

        {/* 费用对比 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-10">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-bold text-slate-900">💰 12 个月费用对比（NZD · 不含 GST）</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">项目</th>
                  <th className="text-right px-5 py-3 font-semibold">市场标准价</th>
                  <th className="text-right px-5 py-3 font-semibold">Magic Lab</th>
                  <th className="text-right px-5 py-3 font-semibold">节省</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ['Shopify 网站建设（150 SKU + 主题定制）', '$8,000 – $12,000', '$4,800', '~$5,200'],
                  ['SEO 服务（12 个月 · 20 页/月）', '$2,500/月 × 12 = $30,000', '已含月费', '$30,000'],
                  ['社媒运营（12 个月 · 100 条/月 · 60% 视频）', '$5,500/月 × 12 = $66,000', '已含月费', '$66,000'],
                  ['AI 技能训练营 × 3 席位', '$5,980', '$0（赠送）', '$5,980'],
                  ['Cloudflare CDN & 安全（Business）', '~$240/年', '已含', '$240'],
                  ['Cloudflare 企业邮箱', '~$72/年', '已含', '$72'],
                  ['Render 应用托管', '~$240/年', '已含', '$240'],
                  ['Supabase 数据库（Pro）', '~$300/年', '已含', '$300'],
                  ['Publer 多平台发布（Business）', '~$420/年', '已含', '$420'],
                  ['Zapier 自动化（Professional）', '~$580/年', '已含', '$580'],
                  ['Airtable CRM（Team）', '~$480/年', '已含', '$480'],
                  ['Lovart 设计 AI', '~$360/年', '已含', '$360'],
                  ['HeyGen 数字人视频（Creator）', '~$1,150/年', '已含', '$1,150'],
                  ['月度服务费基础（Magic Lab）', '—', '$3,300/月 × 12 = $39,600', '—'],
                ].map(([item, market, magic, save], i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-700">{item}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{market}</td>
                    <td className="px-5 py-3 text-right text-slate-900 font-medium">{magic}</td>
                    <td className="px-5 py-3 text-right text-emerald-600 font-semibold">{save}</td>
                  </tr>
                ))}
                <tr className="bg-cyan-50 font-bold text-slate-900">
                  <td className="px-5 py-4">12 个月总计</td>
                  <td className="px-5 py-4 text-right text-slate-500 line-through">~$117,162</td>
                  <td className="px-5 py-4 text-right text-cyan-700 text-base">$44,400</td>
                  <td className="px-5 py-4 text-right text-emerald-600 text-base">~$72,762</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-emerald-50 border-t border-emerald-200">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-sm text-emerald-900">
                <strong>Snow Village 12 个月节省：~$72,762 NZD</strong>
                <span className="text-emerald-700 ml-2">（约 62% 成本压缩）</span>
              </div>
              <div className="text-xs text-emerald-700">
                💡 不含 Shopify 自身费用（~$1,192/年 = $400 主题 + $66/月），由客户单独支付
              </div>
            </div>
          </div>
        </div>

        {/* 时间效率对比 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-bold text-slate-900">⚡ 时间效率对比 · AI 增长引擎压缩</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">工作内容</th>
                  <th className="text-right px-5 py-3 font-semibold">行业常规时间</th>
                  <th className="text-right px-5 py-3 font-semibold">Magic Lab AI 引擎</th>
                  <th className="text-right px-5 py-3 font-semibold">效率提升</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ['Shopify 建站 + 150 SKU 迁移', '6 – 8 周', '2 周内交付', '3 – 4 倍'],
                  ['SEO 内容生产（20 页/月）', '80 – 120 小时/月', '20 – 30 小时/月', '4 – 6 倍'],
                  ['短视频与数字人视频制作（60 条/月）', '180 – 240 小时/月', '30 – 40 小时/月', '6 – 8 倍'],
                  ['社媒图文制作（40 条/月）', '60 – 80 小时/月', '10 – 15 小时/月', '5 – 8 倍'],
                  ['SaaS 工具集成与配置（9 项工具栈）', '2 – 4 周', '即时上线', '∞'],
                  ['月度数据分析与报告', '8 – 16 小时/月', '1 – 2 小时/月', '8 – 10 倍'],
                  ['关键词研究与排名追踪（50 词）', '20 – 30 小时/月', '自动化 · <2 小时', '10 – 15 倍'],
                ].map(([work, normal, magic, gain], i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-700">{work}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{normal}</td>
                    <td className="px-5 py-3 text-right text-slate-900 font-medium">{magic}</td>
                    <td className="px-5 py-3 text-right text-cyan-600 font-bold">{gain}</td>
                  </tr>
                ))}
                <tr className="bg-cyan-50 font-bold text-slate-900">
                  <td className="px-5 py-4">综合效率提升</td>
                  <td className="px-5 py-4 text-right text-slate-500">~360 小时/月</td>
                  <td className="px-5 py-4 text-right text-cyan-700 text-base">~70 小时/月</td>
                  <td className="px-5 py-4 text-right text-cyan-700 text-base">~5 倍</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-cyan-50 border-t border-cyan-200">
            <div className="text-sm text-cyan-900">
              <strong>核心价值：</strong>
              <span className="text-cyan-800">同样的产出，传统团队需要 ~3 个全职岗位（FTE），Magic Lab AI 引擎压缩到 ~0.5 FTE 投入即可完成。这正是 $44,400 全包价格的底层经济学支撑。</span>
            </div>
          </div>
        </div>
      </section>

      {/* 07 ROI */}
      <section className="bg-slate-50">
        <div className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="07" label="投资回报" />
        <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>每月 $3,300，需要几台冰柜回本？</h2>
        <p className="text-slate-600 mb-6">
          Snow Village 产品客单价约 $1,000–$3,000，以均值 $2,000 单台毛利约 $600（保守30%毛利率）计算：
        </p>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8">
          <h4 className="font-bold text-emerald-800 mb-5">📊 盈亏平衡测算</h4>
          {[
            ['月度服务费（全包，+GST）', '$3,300'],
            ['单台均价（不含GST）', '~$2,000'],
            ['单台毛利（30%）', '~$600'],
            ['回本所需增量台数', '约 6 台 / 月'],
            ['行业经验：SEO+社媒成熟后带来的月增量', '15–30 台'],
          ].map(([label, val], i) => (
            <div key={i} className={`flex justify-between py-3 text-sm ${i === 4 ? 'border-t-2 border-emerald-300 mt-2 font-bold text-emerald-800 text-base' : 'border-b border-emerald-100 text-slate-700'}`}>
              <span>{label}</span>
              <span className="font-semibold">{val}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-slate-400">
          💡 仅需每月多卖 <strong className="text-slate-600">6 台设备</strong>即可覆盖全部营销成本。该费用已包含 Cloudflare、Render、Supabase、Publer、HeyGen、Lovart 等全部工具栈月费，客户无隐性成本。SEO 流量具有复利效应，第 6 个月后通常可见显著的自然流量增长。
        </p>
        </div>
      </section>

      {/* 推荐 Shopify 模板 */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <SectionLabel num="07+" label="推荐建站模板" />
        <h2 className="text-3xl font-bold text-slate-900 mb-3" style={{ fontFamily: 'serif' }}>精选 Shopify 主题方案</h2>
        <p className="text-slate-600 mb-8">
          以下三款主题经过筛选，最适合 Snow Village 的产品体量与 B2B 采购场景，视觉专业、加载快、支持大型商品目录。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              name: 'Impulse',
              badge: '⭐ 推荐首选',
              badgeColor: 'bg-amber-400 text-slate-900',
              price: '$400',
              rating: '95%',
              reviews: '1,277条评价',
              img: 'https://cdn.shopify.com/theme-store/nwsu7gqs6tu8mo6ndlosrkek2fpj.jpg',
              desc: '专为大促销和转化率优化设计，内置倒计时、促销横幅、产品徽章，移动端极致流畅。',
              tags: ['促销功能强', '移动优先', '大图展示'],
              url: 'https://themes.shopify.com/themes/impulse/styles/impulse/preview',
            },
            {
              name: 'Warehouse',
              badge: '大目录首选',
              badgeColor: 'bg-cyan-100 text-cyan-800',
              price: '$320',
              rating: '85%',
              reviews: '323条评价',
              img: 'https://cdn.shopify.com/theme-store/3ptcwe878ov4bm9b2s0e237kz0bw.jpg',
              desc: '专为千级SKU大目录打造，Mega Menu 导航、高级筛选器，B2B采购体验一流。',
              tags: ['大目录优化', 'Mega Menu', '快速筛选'],
              url: 'https://themes.shopify.com/themes/warehouse/styles/warehouse/preview',
            },
            {
              name: 'Prestige',
              badge: '高端品牌感',
              badgeColor: 'bg-purple-100 text-purple-800',
              price: '$400',
              rating: '91%',
              reviews: '841条评价',
              img: 'https://cdn.shopify.com/theme-store/lw0dt3iyqmg8k6edbxvndorguyoa.jpg',
              desc: '高端品牌质感，30+可配置模块，适合打造行业标杆形象，提升客户信任度。',
              tags: ['高端视觉', '30+模块', '品牌升级'],
              url: 'https://themes.shopify.com/themes/prestige/styles/allure/preview',
            },
          ].map((theme) => (
            <div key={theme.name} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={theme.img}
                  alt={`${theme.name} Shopify 主题预览`}
                  className="w-full h-44 object-cover object-top"
                  loading="lazy"
                />
                <span className={`absolute top-3 left-3 text-xs font-bold px-2 py-1 rounded ${theme.badgeColor}`}>
                  {theme.badge}
                </span>
              </div>
              <div className="p-5 flex flex-col flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-900 text-base">{theme.name}</h4>
                  <span className="text-lg font-bold text-slate-900">{theme.price}</span>
                </div>
                <div className="text-xs text-slate-400 mb-3">好评率 {theme.rating} · {theme.reviews}</div>
                <p className="text-sm text-slate-500 mb-4 flex-1">{theme.desc}</p>
                <div className="flex flex-wrap gap-1 mb-4">
                  {theme.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">{tag}</span>
                  ))}
                </div>
                <a
                  href={theme.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-sm font-semibold text-cyan-700 border border-cyan-300 rounded-lg py-2 hover:bg-cyan-50 transition-colors"
                >
                  查看主题 Demo →
                </a>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-slate-400">
          💡 Magic Lab 会根据 Snow Village 最终的视觉偏好与功能需求，在启动会议时确认最终主题选择，主题费用已包含在建站报价中。
        </p>
      </section>

      {/* 08 下一步 */}
      <section className="bg-slate-50">
        <div className="max-w-4xl mx-auto px-8 py-16">
          <SectionLabel num="08" label="下一步" />
          <h2 className="text-3xl font-bold text-slate-900 mb-8" style={{ fontFamily: 'serif' }}>确认合作后，我们立刻开始</h2>
          <div className="space-y-5">
            {[
              { day: '今天', title: '签订合作协议', desc: '确认服务范围、定价、付款条款（建议首月预付建站费+首月月费）' },
              { day: '第1天', title: '启动会议', desc: '品牌素材交接、产品数据导出、关键词研究启动、社媒账号授权' },
              { day: '第5天', title: '网站首稿', desc: '提交首页设计稿，确认视觉方向，开始产品批量导入' },
              { day: '第14天', title: '新网站上线', desc: '完成测试、域名切换，网站正式对外开放' },
              { day: '第15天', title: 'SEO + 社媒全面启动', desc: '第一批 SEO 页面上线，第一批社媒内容发布，数据追踪体系建立' },
            ].map((step, i) => (
              <div key={i} className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-full bg-cyan-700 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">{i + 1}</div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-slate-900">{step.title}</span>
                    <span className="text-xs text-cyan-600 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded">{step.day}</span>
                  </div>
                  <p className="text-sm text-slate-500">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-8 py-16 text-center">
        <h2 className="text-3xl font-bold text-slate-900 mb-4" style={{ fontFamily: 'serif' }}>准备好开始了吗？</h2>
        <p className="text-slate-500 mb-8">本提案有效期 30 天，现在联系我们锁定专属报价</p>
        <a
          href="/contact"
          className="inline-block bg-cyan-600 hover:bg-cyan-700 text-white font-semibold px-10 py-4 rounded-xl transition-colors text-base"
        >
          立即联系 Magic Lab →
        </a>
      </section>

    </div>
  );
}

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs font-bold text-cyan-600 uppercase tracking-widest mb-3">
      <div className="w-6 h-0.5 bg-cyan-500" />
      {num} · {label}
    </div>
  );
}

/* ─── Competitor sites ─── */

const competitorSites = [
  {
    name: 'Southern Hospitality',
    url: 'https://www.southernhospitality.co.nz',
    screenshot: '/images/competitors/southern-hospitality.png',
    rating: '较好',
    ratingColor: 'bg-amber-100 text-amber-700',
    note: '行业龙头，网站较完善，有在线购买，SEO 一般',
  },
  {
    name: 'Simco Catering',
    url: 'https://simcocateringequipment.co.nz',
    screenshot: '/images/competitors/simco-catering.png',
    rating: '一般',
    ratingColor: 'bg-orange-100 text-orange-700',
    note: '功能性网站，布局密集，SEO 较弱，无 TikTok',
  },
  {
    name: 'Flocon NZ',
    url: 'https://www.flocon.co.nz',
    screenshot: '/images/competitors/flocon-nz.png',
    rating: '较差',
    ratingColor: 'bg-red-100 text-red-600',
    note: '以服务安装为主，产品展示薄弱，SEO 极弱',
  },
  {
    name: 'Chilled Status',
    url: 'https://chilledstatus.co.nz',
    screenshot: '/images/competitors/chilled-status.png',
    rating: '一般',
    ratingColor: 'bg-orange-100 text-orange-700',
    note: '本地服务商，网站简单，无内容策略，无社媒运营',
  },
];
