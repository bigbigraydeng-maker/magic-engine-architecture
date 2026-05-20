import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const MagicLogo = () => (
  <svg width="30" height="28" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z"
          fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60" fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60" fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
);

const FREE_FEATURES = [
  {
    icon: '🩺',
    title: 'Brand Health Score',
    desc: '6-dimension scan: SEO, AI visibility, social, ads, reputation & competitors — scored instantly',
  },
  {
    icon: '⚠️',
    title: 'Weakness Discovery',
    desc: 'AI pinpoints your top 3 digital blind spots and explains exactly why they are costing you customers',
  },
  {
    icon: '📊',
    title: 'Visibility Snapshot',
    desc: 'See how your business appears — or disappears — across Google and AI search engines right now',
  },
];

const FDE_FEATURES = [
  { icon: '💊', title: 'Custom Action Roadmap', desc: 'Prioritised fix plan built around your business goals' },
  { icon: '🤖', title: 'Automated Content Engine', desc: 'SEO blogs, social campaigns & GEO optimisation — all automated' },
  { icon: '📈', title: 'Execution Tracking', desc: 'Every action tracked with real ROI attribution' },
  { icon: '📋', title: 'Monthly Intelligence Reports', desc: 'Automated performance reports delivered to your inbox' },
  { icon: '👥', title: 'Dedicated Specialist', desc: 'A human expert oversees your strategy and execution end-to-end' },
];

const SAMPLE_SCORES = [
  { label: 'SEO',          value: 28, bad: true  },
  { label: 'AI Visibility', value: 12, bad: true  },
  { label: 'Social',        value: 45, bad: false },
  { label: 'Ads',           value: 62, bad: false },
  { label: 'Reputation',    value: 71, bad: false },
  { label: 'Competitors',   value: 33, bad: true  },
];

const SAMPLE_ISSUES = [
  'Your business does not appear in ChatGPT or Perplexity searches',
  'Missing from 8 high-volume local keywords your competitors rank for',
  '47 technical SEO errors are slowing your site and hurting rankings',
];

export default async function HomePage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-[#060E1A] text-white" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}>

      {/* ── Sticky Nav ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-3.5"
           style={{ background: 'rgba(6,14,26,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(70,125,215,0.1)' }}>
        <div className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: 'rgba(160,195,255,0.6)' }}
          >
            Sign in
          </Link>
          <a
            href="/discover"
            className="text-[13px] font-bold px-4 py-2 rounded-lg transition-all"
            style={{
              background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
              border: '1px solid rgba(75,135,225,0.32)',
              color: '#EEF4FF',
            }}
          >
            Talk to Us →
          </a>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-20 px-5 text-center overflow-hidden">
        {/* Glow orbs */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div style={{
            position: 'absolute', top: '-60px', left: '50%', transform: 'translateX(-50%)',
            width: '700px', height: '420px',
            background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(38,82,162,0.22) 0%, transparent 65%)',
          }} />
          <div style={{
            position: 'absolute', top: '120px', left: '15%',
            width: '300px', height: '300px',
            background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(18,45,95,0.14) 0%, transparent 70%)',
          }} />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-6"
               style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Free Brand Discovery · No login required
          </div>

          <h1 className="text-[48px] sm:text-[58px] font-black leading-tight tracking-tight mb-5"
              style={{ color: '#ECF3FF' }}>
            Is Your Business<br />
            <span style={{ background: 'linear-gradient(90deg,#5B9EFF,#67E8F9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Invisible Online?
            </span>
          </h1>

          <p className="text-[16px] leading-relaxed mb-10 max-w-xl mx-auto"
             style={{ color: 'rgba(120,170,230,0.58)' }}>
            Get a free 6-dimension brand health scan. Discover exactly where you&apos;re losing customers online — in under 60 seconds.
          </p>

          {/* URL form */}
          <form action="/discover" method="GET" className="flex gap-2.5 max-w-lg mx-auto">
            <input
              type="text"
              name="url"
              placeholder="yourwebsite.com.au"
              className="flex-1 px-4 py-3 text-[14px] rounded-xl outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(70,125,215,0.2)',
                color: '#EEF4FF',
              }}
            />
            <button
              type="submit"
              className="px-6 py-3 rounded-xl text-[14px] font-bold whitespace-nowrap transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Scan Free →
            </button>
          </form>
          <p className="text-[11px] mt-3" style={{ color: 'rgba(255,255,255,0.18)' }}>
            No signup &middot; No credit card &middot; Instant results
          </p>
        </div>
      </section>

      {/* ── Sample Discovery Card ──────────────────────────────────────────────── */}
      <section className="px-5 pb-16 max-w-2xl mx-auto">
        <p className="text-center text-[11px] uppercase tracking-widest mb-4 font-semibold"
           style={{ color: 'rgba(120,170,230,0.3)' }}>
          Sample Discovery Report
        </p>
        <div className="rounded-2xl overflow-hidden"
             style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)', backdropFilter: 'blur(12px)' }}>
          {/* Card header */}
          <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                     style={{ background: 'rgba(239,68,68,0.15)' }}>
                  🔴
                </div>
                <div>
                  <p className="text-[13px] font-bold" style={{ color: '#ECF3FF' }}>
                    Crisis Type: <span style={{ color: '#f87171' }}>AI Invisibility</span>
                  </p>
                  <p className="text-[11px]" style={{ color: 'rgba(120,170,230,0.35)' }}>
                    acme-tours.com.au — just now
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[28px] font-black" style={{ color: '#f87171' }}>32</div>
                <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>/ 100</div>
              </div>
            </div>
          </div>

          {/* Score bars */}
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {SAMPLE_SCORES.map(s => (
              <div key={s.label} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</span>
                  <span className="text-[11px] font-bold tabular-nums"
                        style={{ color: s.value < 40 ? '#f87171' : s.value < 60 ? '#facc15' : '#4ade80' }}>
                    {s.value}
                  </span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-1.5 rounded-full transition-all"
                       style={{
                         width: `${s.value}%`,
                         background: s.value < 40 ? '#ef4444' : s.value < 60 ? '#eab308' : '#22c55e',
                       }} />
                </div>
              </div>
            ))}
          </div>

          {/* Issues */}
          <div className="px-6 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[11px] uppercase tracking-wider font-semibold pt-4 mb-3"
               style={{ color: 'rgba(120,170,230,0.3)' }}>
              Top issues found
            </p>
            <div className="space-y-2">
              {SAMPLE_ISSUES.map((issue, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-[10px]" style={{ color: '#f87171' }}>●</span>
                  <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.45)' }}>{issue}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Locked section with blur */}
          <div className="relative px-6 pb-6" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="pt-4 space-y-2 select-none" style={{ filter: 'blur(4px)', opacity: 0.25 }}>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>
                ◼ 14 competitor keyword gaps identified
              </div>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>
                ◼ Custom 90-day action roadmap...
              </div>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>
                ◼ GEO optimisation opportunities...
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 top-4 flex flex-col items-center justify-center"
                 style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.95) 50%)' }}>
              <a
                href="/discover"
                className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                  border: '1px solid rgba(75,135,225,0.35)',
                  color: '#EEF4FF',
                }}
              >
                Get Your Free Report →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── What's Free ───────────────────────────────────────────────────────── */}
      <section className="px-5 pb-16 max-w-4xl mx-auto">
        <h2 className="text-center text-[22px] font-black mb-2" style={{ color: '#ECF3FF' }}>
          What You Get — Free
        </h2>
        <p className="text-center text-[13px] mb-10" style={{ color: 'rgba(120,170,230,0.4)' }}>
          No strings. No credit card. Just the truth about your online presence.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {FREE_FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl p-5"
                 style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}>
              <div className="text-[26px] mb-3">{f.icon}</div>
              <p className="text-[14px] font-bold mb-1.5" style={{ color: '#ECF3FF' }}>{f.title}</p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(120,170,230,0.5)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tier Comparison ───────────────────────────────────────────────────── */}
      <section className="px-5 pb-20 max-w-3xl mx-auto">
        <h2 className="text-center text-[22px] font-black mb-2" style={{ color: '#ECF3FF' }}>Simple & Transparent</h2>
        <p className="text-center text-[13px] mb-10" style={{ color: 'rgba(120,170,230,0.4)' }}>
          Discovery is free forever. Execution is where the magic happens.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">

          {/* Free tier */}
          <div className="rounded-2xl p-6 flex flex-col"
               style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(70,125,215,0.12)' }}>
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#5B9EFF' }}>
                Discovery
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color: '#ECF3FF' }}>$0</div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>forever free</div>
            </div>
            <div className="space-y-3 flex-1">
              {FREE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-green-400 mt-0.5 text-[12px]">✓</span>
                  <span className="text-[12px] font-medium" style={{ color: 'rgba(200,225,255,0.7)' }}>{f.title}</span>
                </div>
              ))}
            </div>
            <a
              href="/discover"
              className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid rgba(70,125,215,0.2)', color: 'rgba(160,195,255,0.6)' }}
            >
              Start Free Scan →
            </a>
          </div>

          {/* FDE tier */}
          <div className="rounded-2xl p-6 flex flex-col relative overflow-hidden"
               style={{ background: 'rgba(22,45,90,0.3)', border: '1px solid rgba(75,135,225,0.3)' }}>
            <div className="absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
                 style={{ background: 'rgba(38,82,162,0.8)', color: '#7ABFFF', border: '1px solid rgba(75,135,225,0.3)' }}>
              FDE
            </div>
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#67E8F9' }}>
                Full Execution
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color: '#ECF3FF' }}>Custom</div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>based on your business</div>
            </div>
            <div className="space-y-3 flex-1">
              {FDE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-[14px] flex-shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'rgba(200,225,255,0.8)' }}>{f.title}</p>
                    <p className="text-[11px] leading-snug" style={{ color: 'rgba(120,170,230,0.45)' }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="/discover"
              className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-bold transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Talk to Us →
            </a>
          </div>

        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <section className="px-5 pb-24 max-w-2xl mx-auto text-center">
        <div className="rounded-2xl p-10"
             style={{ background: 'rgba(22,45,90,0.25)', border: '1px solid rgba(70,125,215,0.18)' }}>
          <h2 className="text-[28px] font-black mb-3" style={{ color: '#ECF3FF' }}>
            Ready to fix what&apos;s broken?
          </h2>
          <p className="text-[13px] mb-8" style={{ color: 'rgba(120,170,230,0.45)' }}>
            Start with a free scan — then let&apos;s talk about what to do with the results.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/discover"
              className="px-6 py-3 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid rgba(70,125,215,0.2)', color: 'rgba(160,195,255,0.65)' }}
            >
              Free Scan →
            </a>
            <a
              href="/discover"
              className="px-6 py-3 rounded-xl text-[13px] font-bold transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Talk to Us →
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="px-5 py-6 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-[11px]" style={{ color: 'rgba(70,115,185,0.3)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026 &nbsp;·&nbsp; AI · AUTOMATION · FUTURE
        </p>
      </footer>

    </div>
  );
}
