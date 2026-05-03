import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CTS Tours — SEO 阶段报告 2026-04-25 | Magic Lab',
  description: 'CTS Tours SEO 获客引擎阶段报告：19天49页内容、GSC实测553次点击、三条Spotlight产品线组合拳策略。',
  robots: 'noindex, nofollow',
};

/* ─── Color helpers ─── */
const G = 'text-emerald-700';
const A = 'text-amber-700';
const P = 'text-indigo-700';
const R = 'text-red-700';
const B = 'text-blue-700';

export default function CTSToursSEOReport() {
  return (
    <div className="min-h-screen pt-16" style={{ background: '#f5f4f0', color: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: '14px' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* ── Header ── */}
        <div className="rounded-xl p-7 mb-6 flex justify-between items-center" style={{ background: '#1a2b3c', color: '#fff' }}>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">CTS Tours — SEO 阶段报告</h1>
            <p className="text-sm mt-1" style={{ color: '#8fa8be' }}>数据来源：GSC 实测 55天 + 关键词竞品分析 · 生成日期 2026-04-25</p>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full tracking-wide" style={{ background: '#0f6e56', color: '#fff' }}>
            Magic Lab SEO 获客引擎
          </span>
        </div>

        {/* ── 项目总览 ── */}
        <Section title="项目总览 · 从代码推算">
          <div className="grid grid-cols-5 gap-3">
            {[
              { num: '19天', cls: G, label: 'SEO集中建设', sub: '4/6 → 4/25' },
              { num: '7周', cls: A, label: '整站从零搭建', sub: '3/7 → 4/25' },
              { num: '49', cls: P, label: 'SEO页面/文章', sub: '上线数量' },
              { num: '553次', cls: B, label: 'GSC总点击', sub: '55天基线数据' },
              { num: '4.76%', cls: R, label: '平均 CTR', sub: '678个有展示词' },
            ].map((m) => (
              <MetricCard key={m.label} num={m.num} numCls={m.cls} label={m.label} sub={m.sub} />
            ))}
          </div>
        </Section>

        {/* ── Spotlight 三条产品线 ── */}
        <Section title="核心任务 #1 · Spotlight 三条产品线推广战略（SEO + 社媒组合拳）">
          <Insight color="blue">
            <strong>战略核心：</strong>三条 Spotlight 产品线是 CTS 差异化的核心资产——不是通用的"中国旅游"，而是有故事、有情绪、有病毒传播力的具体行程。SEO 捕获搜索意图流量，社媒 AI 引擎提前种草，两条链路同时驱动同一个产品页。
          </Insight>
          <div className="grid grid-cols-3 gap-4">
            <SpotlightCard
              lineLabel="Line A · 北京 / 西安"
              lineCls="text-blue-700"
              name="A Tale of Two Cities"
              sub="10天 · NZD $3,480 · Discovery"
              ctaLabel="最快出单线"
              ctaCls="bg-blue-700"
              rows={[
                ['目标关键词', 'beijing xian itinerary 10 days'],
                ['月搜索量', <span key="sv" className="text-emerald-700 font-semibold">SV 高（长尾组合）</span>],
                ['竞品 #1', 'Wendy Wu（难度极易）'],
                ['内容已上线', <span key="c" className="text-emerald-700 font-semibold">5篇长尾博客 ✓</span>],
                ['SEO内链', <span key="s" className="text-emerald-700 font-semibold">Guide页已挂产品卡 ✓</span>],
                ['社媒角度', '故宫 / 长城 / 西安城墙夜'],
              ]}
              actions={[
                'SEO: terracotta warriors tour H1加"tour"词，抢 Wendy Wu #1',
                '博客: "10-Day Beijing Xian Itinerary" 已上线，等 GSC 收录',
                '社媒: Reels — 长城 vs 兵马俑，哪个更震撼？互动票选',
                '落地页: /tours/china/discovery/beijing-xian 产品页直达',
              ]}
            />
            <SpotlightCard
              lineLabel="Line B · 上海周边"
              lineCls="text-indigo-700"
              name="Shanghai & Surroundings"
              sub="8天 · Discovery"
              ctaLabel="视觉传播最强线"
              ctaCls="bg-indigo-700"
              rows={[
                ['目标关键词', 'shanghai suzhou hangzhou itinerary'],
                ['月搜索量', <span key="sv" className="text-emerald-700 font-semibold">SV 中等（水乡词组合）</span>],
                ['竞品格局', '上海词 Wendy Wu #1，但周边词弱'],
                ['内容已上线', <span key="c" className="text-emerald-700 font-semibold">5篇长尾博客 ✓</span>],
                ['SEO内链', <span key="s" className="text-emerald-700 font-semibold">Shanghai Guide 已挂产品卡 ✓</span>],
                ['社媒角度', '苏州园林 / 乌镇水乡 / 西湖断桥'],
              ]}
              actions={[
                'SEO: Shanghai Guide meta 加 "shanghai day trips" 和 "suzhou" 词',
                '博客: "China Water Towns Jiangnan Guide" 已上线，差异化词',
                '社媒: 视频对比 — 苏州VS乌镇，NZ旅行者怎么选？',
                '落地页: /tours/china/discovery/shanghai-surroundings 直达',
              ]}
            />
            <SpotlightCard
              lineLabel="Line C · 重庆 / 成都"
              lineCls="text-red-700"
              name="Fire & Fuzz"
              sub="10天 · NZD $2,999 · Discovery"
              ctaLabel="病毒传播潜力最高"
              ctaCls="bg-red-700"
              rows={[
                ['目标关键词', 'chongqing chengdu itinerary'],
                ['月搜索量(AU)', <span key="sv" className="text-emerald-700 font-semibold">chengdu panda SV 320 ⚡</span>],
                ['竞品格局', '#1 是官方熊猫基地，非旅游商'],
                ['内容已上线', <span key="c" className="text-emerald-700 font-semibold">5篇长尾博客 ✓</span>],
                ['SEO内链', <span key="s" className="text-emerald-700 font-semibold">Chongqing Guide 已优化 ✓</span>],
                ['社媒角度', '穿楼地铁 / 洪崖洞 / 抱熊猫'],
              ]}
              actions={[
                'SEO: 建 /chengdu-panda-sanctuary 专项页，抢 SV 320 无竞争词',
                '博客: "Liziba Station Chongqing Guide" 已上线，病毒潜力最高',
                '社媒: Reels — 穿楼地铁第一视角，NZ人的反应',
                '落地页: /tours/china/discovery/chongqing-chengdu 直达',
              ]}
            />
          </div>
          <Insight>
            <strong>SEO + 社媒组合拳运作方式：</strong>社媒 AI 引擎（Airtable → Zapier → Publer）每周推送 3 条目的地视觉内容，在用户心智中种下 "重庆/成都/北京西安/上海水乡" 的旅游冲动。3–4 周后，这批被种草的用户去 Google 搜索 "chongqing tour new zealand"，正好命中 CTS 的 Guide 页和博客，自然引导到 Fire &amp; Fuzz 产品页。<strong>社媒建立情绪，SEO 完成转化。</strong>两个引擎共享同一批内容素材，一次生产，双倍曝光。
          </Insight>
        </Section>

        {/* ── GSC 实测数据 ── */}
        <Section title="核心任务 #2 · GSC 实测数据与 CTR 修复">
          <Insight>
            <strong>关键发现：</strong>品牌词（cts tours、china travel service nz）点击率极高（31–46%），说明品牌认知良好。但商业通用词（china tours pos 33、china tour packages pos 19）点击接近零——这是最快 ROI 的修复方向。
          </Insight>
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#f9f8f5' }}>
                  {['关键词', '点击', '展示', 'CTR', '当前排名', '词类型', '趋势'].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#666', borderBottom: '1px solid #e8e6e0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { kw: 'cts tours', clicks: 100, imp: 216, ctr: '46.3%', pos: 'pos 2.3', posType: 'top', type: '品牌词', typeStyle: 'done', barW: '92%', barC: '#1d9e75' },
                  { kw: 'china travel service nz', clicks: 28, imp: 89, ctr: '31.5%', pos: 'pos 5.8', posType: 'top', type: '品牌词', typeStyle: 'done', barW: '63%', barC: '#1d9e75' },
                  { kw: 'china travel service', clicks: 16, imp: 191, ctr: '8.4%', pos: 'pos 11.7', posType: 'mid', type: '品牌词', typeStyle: 'done', barW: '17%', barC: '#1d9e75' },
                  { kw: 'china trips', clicks: 0, imp: 151, ctr: '0%', pos: 'pos 60', posType: 'low', type: '已修复', typeStyle: 'fix', barW: '0%', barC: '#e24b4a', note: '今日加入首页meta' },
                  { kw: 'china tours', clicks: 4, imp: 591, ctr: '0.7%', pos: 'pos 33.1', posType: 'low', type: '攻坚词', typeStyle: 'fix', barW: '1%', barC: '#e24b4a', note: 'Wendy Wu #1' },
                  { kw: 'china tour packages', clicks: 0, imp: 36, ctr: '0%', pos: 'pos 19.5', posType: 'low', type: '待优化', typeStyle: 'next', barW: '0%', barC: '#ef9f27' },
                  { kw: 'china tours from new zealand', clicks: 4, imp: '65/月', ctr: '2%', pos: 'pos 7', posType: 'mid', type: 'CTR已修复', typeStyle: 'fix', barW: '4%', barC: '#ef9f27' },
                ].map((row) => (
                  <tr key={row.kw} className="border-b hover:bg-stone-50" style={{ borderColor: '#f0ede8' }}>
                    <td className="px-3 py-2.5 font-medium text-sm">{row.kw}</td>
                    <td className="px-3 py-2.5 text-sm">{row.clicks}</td>
                    <td className="px-3 py-2.5 text-sm">{row.imp}</td>
                    <td className="px-3 py-2.5 text-sm">{row.ctr}</td>
                    <td className="px-3 py-2.5"><PosBadge pos={row.pos} type={row.posType as 'top' | 'mid' | 'low'} /></td>
                    <td className="px-3 py-2.5"><StatusBadge label={row.type} style={row.typeStyle as 'done' | 'fix' | 'live' | 'next'} /></td>
                    <td className="px-3 py-2.5">
                      <div className="h-2 rounded-full w-24" style={{ background: '#f0ede8' }}>
                        <div className="h-2 rounded-full" style={{ width: row.barW, background: row.barC }} />
                      </div>
                      {row.note && <span className="text-xs mt-0.5 block" style={{ color: '#993c1d' }}>{row.note}</span>}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: '#f9f8f5', fontWeight: 600 }}>
                  <td className="px-3 py-2.5 text-sm">合计</td>
                  <td className="px-3 py-2.5 text-sm">553次/55天</td>
                  <td className="px-3 py-2.5 text-sm">11,625</td>
                  <td className="px-3 py-2.5 text-sm">4.76%</td>
                  <td className="px-3 py-2.5 text-sm">avg pos 10.2</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-sm text-emerald-700">月均~300次点击基线</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── 关键词机会 ── */}
        <Section title="核心任务 #3 · 关键词机会 · 竞品分析交叉验证">
          <Insight>
            <strong>竞品数据揭示：</strong>"china tours" Wendy Wu 排 #1 但 Page Authority 仅 7、只有 2 条外链——不是靠权重赢的，是靠内容相关性。CTS 内容已补上，6个月内可超越。
          </Insight>
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#f9f8f5' }}>
                  {['关键词', '月搜索量', '难度', 'CTS当前', 'Wendy Wu', '#1位竞品', '预计月增点击', '行动状态'].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#666', borderBottom: '1px solid #e8e6e0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { kw: 'china tours from new zealand', sv: 140, kd: 'easy', kdLabel: 'KD 4', cts: { pos: 'pos 7', type: 'mid' }, ww: '未排名', no1: '—', opp: '+15–25次', oppType: 'high', status: 'CTR已修复', statusStyle: 'fix' },
                  { kw: 'china tour packages', sv: 170, kd: 'easy', kdLabel: 'KD 9', cts: { pos: 'pos 29', type: 'low' }, ww: 'pos 5', wwTop: true, no1: 'tripadeal.co.nz', opp: '+8–15次', oppType: 'mid', status: '待优化', statusStyle: 'next' },
                  { kw: 'china holiday packages', sv: 170, kd: 'easy', kdLabel: 'KD 9', cts: { pos: 'pos 43', type: 'low' }, ww: 'pos 3', wwTop: true, no1: 'houseoftravel.co.nz', opp: '+6–12次', oppType: 'mid', status: 'Title已修复', statusStyle: 'fix' },
                  { kw: 'china tours', sv: 260, kd: 'mid', kdLabel: 'KD 16', cts: { pos: 'pos 33', type: 'low' }, ww: 'pos 1 (AS:7)', wwTop: true, no1: 'wendywutours.co.nz', opp: '+10–20次 (6mo)', oppType: 'mid', status: '长期攻坚', statusStyle: 'next' },
                  { kw: 'terracotta warriors tour', sv: 30, kd: 'easy', kdLabel: 'KD 极易', cts: { pos: '未排名', type: 'none' }, ww: 'pos 1', wwTop: true, no1: 'wendywutours.co.nz', opp: '+5–10次', oppType: 'mid', status: 'Guide已有，加"tour"', statusStyle: 'live' },
                  { kw: 'chengdu panda sanctuary', sv: 320, kd: 'mid', kdLabel: 'KD 35', cts: { pos: 'pos 10 (5展示)', type: 'mid' }, ww: '未排名', no1: 'panda.org.cn (非旅游商)', opp: '+15–30次 ⚡', oppType: 'high', status: '专项页待建', statusStyle: 'next' },
                  { kw: 'china tours from australia', sv: '720 (AU)', kd: 'easy', kdLabel: 'KD 25', cts: { pos: '未排名', type: 'none' }, ww: '未知', no1: 'AU竞品', opp: '+10–20次 (6mo)', oppType: 'high', status: '页面已上线', statusStyle: 'live' },
                ].map((row) => (
                  <tr key={row.kw} className="border-b hover:bg-stone-50" style={{ borderColor: '#f0ede8' }}>
                    <td className="px-3 py-2.5 font-medium text-sm">{row.kw}</td>
                    <td className="px-3 py-2.5 text-sm">{row.sv}</td>
                    <td className="px-3 py-2.5 text-sm">
                      <span className={`font-semibold ${row.kd === 'easy' ? 'text-emerald-700' : 'text-amber-700'}`}>{row.kdLabel}</span>
                    </td>
                    <td className="px-3 py-2.5"><PosBadge pos={row.cts.pos} type={row.cts.type as 'top' | 'mid' | 'low' | 'none'} /></td>
                    <td className="px-3 py-2.5 text-sm">{row.ww && row.wwTop ? <PosBadge pos={row.ww} type="top" /> : <span>{row.ww}</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">{row.no1}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold">
                      <span className={row.oppType === 'high' ? 'text-emerald-700' : 'text-amber-700'}>{row.opp}</span>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge label={row.status} style={row.statusStyle as 'done' | 'fix' | 'live' | 'next'} /></td>
                  </tr>
                ))}
                <tr style={{ background: '#f9f8f5', fontWeight: 600 }}>
                  <td colSpan={6} className="px-3 py-2.5 text-sm text-emerald-700">全部机会词合计预测（6个月）</td>
                  <td className="px-3 py-2.5 text-base text-emerald-700">+89–167次/月</td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">约翻2–3倍基线</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── 竞品对比 ── */}
        <Section title="竞品对比 · CTS Tours vs Wendy Wu">
          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white rounded-xl p-5 border-2 border-emerald-400">
              <h3 className="font-semibold mb-3 text-emerald-700">CTS Tours (ctstours.co.nz)</h3>
              {[
                ['成立', '1928，98年 NZ 本地专注'],
                ['定位', 'Auckland直营，China专家'],
                ['SEO内容页', <span key="s" className="text-emerald-700 font-semibold">49页（19天建完）</span>],
                ['NZ签证专页', <span key="v" className="text-emerald-700 font-semibold">✓ 专页 + 全站覆盖</span>],
                ['Schema.org', <span key="sc" className="text-emerald-700 font-semibold">✓ 全覆盖（JSON-LD）</span>],
                ['china tours 排名', 'pos 33（攻坚中）'],
                ['外链数量', <span key="e" className="text-red-600 font-semibold">极少（最大弱点）</span>],
                ['AU市场', '刚起步，页面已上线'],
                ['护城河', <span key="m" className="text-emerald-700 font-semibold">NZD报价 · 98年 · Auckland团队</span>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between text-xs py-1.5 border-b border-stone-100 last:border-0">
                  <span className="text-stone-500">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl p-5 border border-stone-200">
              <h3 className="font-semibold mb-3">Wendy Wu Tours (wendywutours.co.nz)</h3>
              {[
                ['成立', '英国品牌，NZ本土化'],
                ['定位', '大众亚洲团体游'],
                ['NZ签证专页', <span key="v" className="text-red-500 font-semibold">弱，非本地专注</span>],
                ['china tours 排名', <span key="c" className="text-red-500 font-semibold">pos 1（AS仅7，2外链）</span>],
                ['terracotta warriors tour', <span key="t" className="text-red-500 font-semibold">pos 1（难度极易）</span>],
                ['china vacation packages', <span key="cv" className="text-red-500 font-semibold">pos 3</span>],
                ['shanghai tour', <span key="sh" className="text-red-500 font-semibold">pos 1</span>],
                ['Spotlight产品线', <span key="sp" className="text-red-500 font-semibold">无（通用行程，无故事）</span>],
                ['社媒AI引擎', <span key="sm" className="text-red-500 font-semibold">无</span>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between text-xs py-1.5 border-b border-stone-100 last:border-0">
                  <span className="text-stone-500">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <Insight color="warn">
            <strong>关键差距：</strong>Wendy Wu 靠老域名积累和内容相关性排名，但没有 CTS 的本地专注优势，也没有 Spotlight 产品线的故事力。"北京西安10天 NZD $3,480"和"重庆穿楼地铁 Fire &amp; Fuzz"是 Wendy Wu 完全无法复制的差异化——这正是社媒 AI 引擎最该放大的内容。
          </Insight>
        </Section>

        {/* ── 已完成工作 ── */}
        <Section title="已完成工作 · 19天内交付（Magic Lab 大瑞 一人公司）">
          <div className="grid grid-cols-4 gap-3">
            <DoneCard count="33" label="SEO 内容页" items={['12个 Phase 1 Hub 页', '21个目的地 Travel Guide']} />
            <DoneCard count="16" label="博客与新页面" items={['15篇长尾博客（3条产品线）', '/china-tours-from-australia']} />
            <DoneCard count="6" label="技术 SEO 项目" items={['Schema.org 全站覆盖', 'Sitemap 完整（49个URL）', '5条旧URL 301修复', 'GSC API 日同步集成', '内链审查 + 修复（8个Guide页）', 'CTR meta 优化（4页）']} />
            <DoneCard count="4" label="策略研究" items={['关键词竞品分析（NZ+AU）', 'GSC 500词90天数据解读', '3条Spotlight线 master brief', '竞品 Wendy Wu SERP对比']} />
          </div>
        </Section>

        {/* ── 双引擎架构 ── */}
        <Section title="Magic Lab 获客引擎 · SEO + 社媒双引擎架构">
          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white rounded-xl p-5 border border-stone-200">
              <h3 className="font-semibold mb-3 text-emerald-700">SEO 获客引擎（捕获主动搜索意图）</h3>
              {[
                ['数据层', 'GSC每日自动同步 → Supabase'],
                ['内容层', 'Hub → Guide → Tour 三层漏斗'],
                ['长尾层', '每批15篇覆盖一条产品线'],
                ['技术层', 'Schema.org + Sitemap + CTR优化'],
                ['迭代节奏', '4周一个数据验收周期'],
                ['目标', '6个月 月均300→600次点击'],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between text-xs py-1.5 border-b border-stone-100 last:border-0">
                  <span className="text-stone-500">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl p-5 border border-stone-200">
              <h3 className="font-semibold mb-3 text-indigo-700">社媒 AI 引擎（种草 + 品牌温度）</h3>
              {[
                ['架构', 'Airtable → Zapier → Publer'],
                ['内容来源', '每篇博客自动拆解3条帖子'],
                ['平台', 'Instagram / Facebook / Reels'],
                ['Spotlight焦点', 'Line A / B / C 轮流推送'],
                ['落地页', '社媒流量 → Guide页 → 产品页'],
                ['当前状态', <span key="s" className="text-amber-700 font-semibold">内容就绪，等待开机</span>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between text-xs py-1.5 border-b border-stone-100 last:border-0">
                  <span className="text-stone-500">{k}</span><span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <Insight>
            <strong>双引擎协同：</strong>同一批内容素材，SEO 版本优化关键词上 Google，社媒版本加视觉情绪上 Instagram/Facebook。社媒建立情绪冲动，SEO 完成搜索转化。一次内容生产，双渠道曝光，Wendy Wu 没有这套体系。
          </Insight>
        </Section>

        {/* ── 传统代理对比 ── */}
        <Section title="与传统 SEO 代理公司对比">
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#f9f8f5' }}>
                  {['对比维度', '传统代理公司', 'Magic Lab 大瑞 一人公司'].map((h, i) => (
                    <th key={h} className={`text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider ${i === 2 ? 'text-emerald-700' : ''}`} style={{ color: i === 2 ? undefined : '#666', borderBottom: '1px solid #e8e6e0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['总费用', 'NZD $80,000–130,000', '节省约 $100,000'],
                  ['完成时间', '6–12个月', '19天（SEO部分）/ 7周（整站）'],
                  ['团队规模', '4–5人（策略师+写手+技术+PM）', '1人 + AI（大瑞）'],
                  ['迭代速度', '月度报告，2周审批流程', '当天发现问题，当天上线'],
                  ['数据驱动', '月度 GSC 报告', 'GSC 每日自动同步 Supabase'],
                  ['内容数量', '通常 10–20 页（预算有限）', '49页（含15篇长尾博客）'],
                  ['社媒引擎', '单独报价，不含', 'AI自动化社媒引擎一体化'],
                  ['Spotlight产品推广', '通用内容，无产品故事', 'SEO + 社媒组合拳，锁定3条产品线'],
                ].map(([dim, trad, ml], i) => (
                  <tr key={String(dim)} className="border-b hover:bg-stone-50" style={{ borderColor: '#f0ede8' }}>
                    <td className="px-3 py-2.5 text-sm text-stone-600">{dim}</td>
                    <td className="px-3 py-2.5 text-sm text-stone-500">{trad}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-emerald-700">{ml}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Footer */}
        <div className="text-center text-xs text-stone-400 py-5 border-t border-stone-200 mt-4">
          CTS Tours SEO Report · 生成时间 2026-04-25 · Magic Lab 大瑞 一人公司 · SEO/GEO 获客引擎 CTS 原型项目
        </div>
      </div>
    </div>
  );
}

/* ─── Shared components ─── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <p className="text-xs font-semibold uppercase tracking-widest mb-3 pb-1.5" style={{ color: '#888', borderBottom: '1px solid #e8e6e0' }}>{title}</p>
      {children}
    </div>
  );
}

function Insight({ children, color }: { children: React.ReactNode; color?: 'warn' | 'blue' }) {
  const borderColor = color === 'warn' ? '#ef9f27' : color === 'blue' ? '#378add' : '#0f6e56';
  return (
    <div className="my-4 px-4 py-3 text-sm leading-relaxed rounded-r-lg" style={{ background: '#f9f8f5', borderLeft: `3px solid ${borderColor}` }}>
      {children}
    </div>
  );
}

function MetricCard({ num, numCls, label, sub }: { num: string; numCls: string; label: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-stone-200">
      <div className={`text-2xl font-semibold leading-none mb-1 ${numCls}`}>{num}</div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-xs text-stone-400 mt-0.5">{sub}</div>
    </div>
  );
}

function PosBadge({ pos, type }: { pos: string; type: 'top' | 'mid' | 'low' | 'none' }) {
  const styles: Record<string, string> = {
    top: 'bg-emerald-100 text-emerald-900',
    mid: 'bg-amber-100 text-amber-900',
    low: 'bg-red-100 text-red-900',
    none: 'bg-stone-100 text-stone-500',
  };
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${styles[type]}`}>{pos}</span>;
}

function StatusBadge({ label, style }: { label: string; style: 'done' | 'fix' | 'live' | 'next' }) {
  const styles: Record<string, string> = {
    done: 'bg-emerald-100 text-emerald-900',
    fix: 'bg-amber-100 text-amber-900',
    live: 'bg-indigo-100 text-indigo-900',
    next: 'bg-stone-100 text-stone-500',
  };
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full tracking-wide ${styles[style]}`}>{label}</span>;
}

function SpotlightCard({
  lineLabel, lineCls, name, sub, rows, actions, ctaLabel, ctaCls,
}: {
  lineLabel: string; lineCls: string; name: string; sub: string;
  rows: [string, React.ReactNode][]; actions: string[];
  ctaLabel: string; ctaCls: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-stone-100">
        <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${lineCls}`}>{lineLabel}</p>
        <p className="text-base font-bold">{name}</p>
        <p className="text-xs text-stone-500">{sub}</p>
      </div>
      <div className="px-4 py-3 flex-1">
        {rows.map(([k, v]) => (
          <div key={String(k)} className="flex justify-between text-xs py-1 border-b border-stone-50 last:border-0">
            <span className="text-stone-400">{k}</span>
            <span className="font-semibold text-right ml-2">{v}</span>
          </div>
        ))}
      </div>
      <div className="bg-stone-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">组合拳行动</p>
        {actions.map((a, i) => (
          <div key={i} className="flex gap-1.5 text-xs text-stone-500 py-1">
            <span className="text-stone-300 flex-shrink-0">→</span>
            <span>{a}</span>
          </div>
        ))}
        <span className={`mt-2 inline-block text-xs font-bold text-white px-3 py-1 rounded ${ctaCls}`}>{ctaLabel}</span>
      </div>
    </div>
  );
}

function DoneCard({ count, label, items }: { count: string; label: string; items: string[] }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-stone-200">
      <div className="text-xl font-bold text-emerald-700">{count}</div>
      <div className="text-xs text-stone-500 mt-0.5 mb-3">{label}</div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item} className="flex gap-1.5 text-xs text-stone-400">
            <span className="text-emerald-600 font-bold flex-shrink-0">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
