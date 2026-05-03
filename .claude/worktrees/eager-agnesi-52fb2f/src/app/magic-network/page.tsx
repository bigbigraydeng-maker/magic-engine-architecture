'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const TOAST_DATA = [
  { name: 'Sarah K.',   city: 'Auckland',     stores: 3,  earn: 150 },
  { name: 'James T.',   city: 'Wellington',   stores: 5,  earn: 250 },
  { name: 'Mei L.',     city: 'Christchurch', stores: 2,  earn: 100 },
  { name: 'Daniel R.',  city: 'Auckland',     stores: 8,  earn: 400 },
  { name: 'Priya S.',   city: 'Hamilton',     stores: 4,  earn: 200 },
  { name: 'Tom W.',     city: 'Tauranga',     stores: 6,  earn: 300 },
  { name: 'Aiko M.',    city: 'Auckland',     stores: 1,  earn: 50  },
  { name: 'Carlos V.',  city: 'Wellington',   stores: 10, earn: 500 },
  { name: 'Lucy F.',    city: 'Dunedin',      stores: 3,  earn: 150 },
  { name: 'Ben H.',     city: 'Auckland',     stores: 7,  earn: 350 },
  { name: 'Natalie C.', city: 'Christchurch', stores: 4,  earn: 200 },
  { name: 'Oliver P.',  city: 'Auckland',     stores: 12, earn: 600 },
  { name: 'Yasmin R.',  city: 'Wellington',   stores: 2,  earn: 100 },
  { name: 'Marcus D.',  city: 'Hamilton',     stores: 5,  earn: 250 },
  { name: 'Sophie N.',  city: 'Auckland',     stores: 9,  earn: 450 },
];

const ACTIVITY_EVENTS = [
  { initials: 'SK', name: 'Sarah K.',  action: 'completed 3 pharmacies in Auckland',        earn: '$150', time: '2 min ago'  },
  { initials: 'JT', name: 'James T.', action: 'submitted shelf photos in Wellington CBD',   earn: '$50',  time: '11 min ago' },
  { initials: 'ML', name: 'Mei L.',   action: 'onboarded a health pharmacy in Auckland',    earn: '$50',  time: '34 min ago' },
  { initials: 'DR', name: 'Daniel R.',action: 'completed 8-store Auckland route',           earn: '$400', time: '1 hr ago'   },
  { initials: 'PS', name: 'Priya S.', action: 'placed 2 brands at a pharmacy in Hamilton', earn: '$100', time: '2 hrs ago'  },
  { initials: 'TW', name: 'Tom W.',   action: 'onboarded 3 new pharmacies in Tauranga',    earn: '$150', time: '3 hrs ago'  },
];

const PHARMACY_COLORS = [
  { bg: '#0f2a1e', accent: '#22c55e', shelf: '#166534', pill: '#4ade80' },
  { bg: '#0f1f3d', accent: '#3b82f6', shelf: '#1e3a8a', pill: '#60a5fa' },
  { bg: '#2a0f1e', accent: '#ec4899', shelf: '#831843', pill: '#f472b6' },
  { bg: '#1a1a0f', accent: '#eab308', shelf: '#713f12', pill: '#fde047' },
];

const PHARMACIES = [
  { name: 'Health Pharmacy · Newmarket',   loc: 'Auckland, NZ',   brands: 2, colorIdx: 0 },
  { name: 'Community Pharmacy · Ponsonby', loc: 'Auckland, NZ',   brands: 1, colorIdx: 1 },
  { name: 'Wellness Pharmacy · Te Aro',    loc: 'Wellington, NZ', brands: 1, colorIdx: 2 },
  { name: 'Discount Pharmacy · Albany',    loc: 'Auckland, NZ',   brands: 2, colorIdx: 3 },
];

const FAQS = [
  { q: 'Do I need retail or sales experience?', a: "No. We provide everything: product briefs, display guides, and introduction templates. If you can follow instructions and take a clear photo, you're qualified." },
  { q: 'How do I receive payment?', a: 'You submit your bank account when you sign up. After each approved placement, $50 NZD transfers directly to your account within 48 business hours.' },
  { q: 'How many pharmacies can I cover?', a: "As many as you can handle. Some partners cover 3-5 per week; our most active do 15-20. There's no cap." },
  { q: 'What do I actually do inside the pharmacy?', a: 'The pharmacy has agreed to host the products. Walk in, introduce yourself, place items on shelf, arrange per the guide, photograph the display. Usually under 30 minutes.' },
  { q: 'Is this available outside New Zealand?', a: "We're building our NZ network now and will expand to Australia in Q3 2026. Apply now to be first in line." },
  { q: 'What products will I be placing?', a: "Health supplements, vitamins, and wellness products from legitimate ANZ brands. All fully approved for retail sale." },
];

interface ToastItem { id: number; name: string; city: string; stores: number; earn: number; visible: boolean; }
type PharmacyColor = typeof PHARMACY_COLORS[number];
interface PharmacyData { name: string; loc: string; brands: number; colorIdx: number; }

function ToastStack() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idxRef = useRef(0);
  const counterRef = useRef(0);
  useEffect(() => {
    const shuffled = [...TOAST_DATA].sort(() => Math.random() - 0.5);
    const fire = () => {
      const d = shuffled[idxRef.current % shuffled.length];
      idxRef.current++;
      const id = counterRef.current++;
      setToasts(prev => [...prev, { ...d, id, visible: true }]);
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t));
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 600);
      }, 4500);
    };
    const initial = setTimeout(fire, 2000);
    const interval = setInterval(fire, 6500 + Math.random() * 3000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, []);
  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-3 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} style={{ transition: 'opacity 0.5s ease, transform 0.4s ease', opacity: t.visible ? 1 : 0, transform: t.visible ? 'translateX(0)' : 'translateX(-30px)' }}
          className="flex items-center gap-3 bg-slate-800/95 border border-blue-500/20 border-l-2 border-l-cyan-400 rounded-xl px-4 py-3 max-w-xs shadow-2xl backdrop-blur-md text-sm">
          <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center text-base shrink-0">💊</div>
          <div>
            <div className="font-semibold text-white text-xs">{t.name} · {t.city}</div>
            <div className="text-slate-400 text-xs mt-0.5">Placed {t.stores} {t.stores === 1 ? 'store' : 'stores'} · earned <span className="text-cyan-400 font-bold">+${t.earn} NZD</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EarningsCalc() {
  const [pharmacies, setPharmacies] = useState(5);
  const [weeks, setWeeks] = useState(3);
  const monthly = pharmacies * weeks * 50;
  const annual = monthly * 12;
  return (
    <div className="bg-white/[0.03] border border-blue-500/20 rounded-2xl p-10 max-w-2xl mx-auto mt-14">
      <div className="text-lg font-bold mb-1">Your Earning Potential</div>
      <div className="text-slate-400 text-sm mb-9">Based on $50 per pharmacy placement</div>
      <div className="mb-7">
        <div className="flex justify-between text-sm mb-2.5">
          <span className="text-slate-300">Pharmacies per week</span>
          <span className="text-cyan-400 font-bold">{pharmacies} {pharmacies === 1 ? 'store' : 'stores'}</span>
        </div>
        <input type="range" min={1} max={20} value={pharmacies} onChange={e => setPharmacies(Number(e.target.value))} className="w-full h-1.5 rounded bg-blue-500/20 accent-blue-400 cursor-pointer" />
      </div>
      <div className="mb-9">
        <div className="flex justify-between text-sm mb-2.5">
          <span className="text-slate-300">Weeks active per month</span>
          <span className="text-cyan-400 font-bold">{weeks} {weeks === 1 ? 'week' : 'weeks'}</span>
        </div>
        <input type="range" min={1} max={4} value={weeks} onChange={e => setWeeks(Number(e.target.value))} className="w-full h-1.5 rounded bg-blue-500/20 accent-blue-400 cursor-pointer" />
      </div>
      <div className="grid grid-cols-2 gap-5 bg-gradient-to-br from-blue-500/10 to-cyan-500/5 border border-blue-500/20 rounded-xl p-7">
        <div className="text-center">
          <div className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">${monthly.toLocaleString()}</div>
          <div className="text-slate-400 text-xs mt-1">Est. monthly earnings</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">${annual.toLocaleString()}</div>
          <div className="text-slate-400 text-xs mt-1">Est. annual earnings</div>
        </div>
      </div>
    </div>
  );
}

function FaqList() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-12 max-w-2xl">
      {FAQS.map((faq, i) => (
        <div key={i} className="border-b border-white/[0.07] py-5">
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex justify-between items-center text-left font-semibold text-sm gap-4 hover:text-blue-400 transition-colors">
            <span>{faq.q}</span>
            <span className="text-slate-400 text-xl shrink-0 transition-transform duration-200" style={{ transform: open === i ? 'rotate(45deg)' : 'none' }}>+</span>
          </button>
          {open === i && <p className="text-slate-400 text-sm leading-relaxed mt-3">{faq.a}</p>}
        </div>
      ))}
    </div>
  );
}

function ApplyForm() {
  const [submitted, setSubmitted] = useState(false);
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); setSubmitted(true); };
  if (submitted) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <div className="text-xl font-bold mb-3">Application received\!</div>
        <div className="text-slate-400 text-sm max-w-sm mx-auto">We will review your details and get back to you within 24 hours.</div>
      </div>
    );
  }
  const inp = "w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 outline-none focus:border-blue-500/50 transition-colors";
  const lbl = "block text-xs font-semibold text-slate-400 mb-2";
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div><label className={lbl}>Full Name</label><input type="text" placeholder="Your full name" required className={inp} /></div>
      <div><label className={lbl}>Email Address</label><input type="email" placeholder="you@email.com" required className={inp} /></div>
      <div><label className={lbl}>Phone Number</label><input type="tel" placeholder="+64 21 000 0000" className={inp} /></div>
      <div>
        <label className={lbl}>Your City</label>
        <select className={inp} defaultValue="">
          <option value="" disabled>Select your city</option>
          {['Auckland','Wellington','Christchurch','Hamilton','Tauranga','Dunedin','Other NZ city','Sydney, AU','Melbourne, AU','Other AU city'].map(c => (
            <option key={c} value={c} className="bg-slate-800">{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={lbl}>How many pharmacies per week can you cover?</label>
        <select className={inp} defaultValue="">
          <option value="" disabled>Select</option>
          {['1-3 (casual)','4-8 (part-time)','9-15 (serious)','15+ (full routes)'].map(o => (
            <option key={o} value={o} className="bg-slate-800">{o}</option>
          ))}
        </select>
      </div>
      <div><label className={lbl}>Anything else? (optional)</label><textarea placeholder="E.g. I have a car, I know pharmacy staff in my area..." rows={3} className={inp + ' resize-y'} /></div>
      <button type="submit" className="w-full py-4 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#3B82F6,#06B6D4)' }}>Apply to Join Magic Network</button>
      <p className="text-center text-slate-500 text-xs">Your details are never shared. We will reply within 24 hours.</p>
    </form>
  );
}

function PharmacyStoreSVG({ c }: { c: PharmacyColor }) {
  return (
    <svg viewBox="0 0 320 160" xmlns="http://www.w3.org/2000/svg" className="w-full" style={{ background: c.bg }}>
      <circle cx="160" cy="80" r="100" fill={c.accent} fillOpacity="0.06" />
      <rect x="60" y="55" width="200" height="90" rx="4" fill={c.shelf} fillOpacity="0.5" />
      <rect x="50" y="48" width="220" height="14" rx="3" fill={c.accent} fillOpacity="0.7" />
      <rect x="90" y="55" width="140" height="22" rx="2" fill={c.accent} fillOpacity="0.2" />
      <rect x="100" y="61" width="60" height="4" rx="2" fill={c.pill} fillOpacity="0.7" />
      <rect x="168" y="61" width="30" height="4" rx="2" fill="#ffffff" fillOpacity="0.3" />
      <rect x="100" y="68" width="40" height="3" rx="1.5" fill={c.pill} fillOpacity="0.4" />
      <rect x="138" y="100" width="44" height="45" rx="2" fill={c.accent} fillOpacity="0.4" />
      <circle cx="176" cy="124" r="2.5" fill={c.pill} fillOpacity="0.8" />
      <rect x="75" y="88" width="42" height="32" rx="2" fill={c.accent} fillOpacity="0.35" />
      <line x1="96" y1="88" x2="96" y2="120" stroke={c.pill} strokeWidth="1" strokeOpacity="0.3" />
      <line x1="75" y1="104" x2="117" y2="104" stroke={c.pill} strokeWidth="1" strokeOpacity="0.3" />
      <rect x="203" y="88" width="42" height="32" rx="2" fill={c.accent} fillOpacity="0.35" />
      <line x1="224" y1="88" x2="224" y2="120" stroke={c.pill} strokeWidth="1" strokeOpacity="0.3" />
      <line x1="203" y1="104" x2="245" y2="104" stroke={c.pill} strokeWidth="1" strokeOpacity="0.3" />
      <rect x="79" y="110" width="7" height="10" rx="1" fill={c.pill} fillOpacity="0.6" />
      <rect x="88" y="107" width="7" height="13" rx="1" fill="#ffffff" fillOpacity="0.25" />
      <rect x="97" y="112" width="7" height="8" rx="1" fill={c.pill} fillOpacity="0.5" />
      <rect x="207" y="109" width="7" height="11" rx="1" fill={c.pill} fillOpacity="0.6" />
      <rect x="216" y="107" width="7" height="13" rx="1" fill="#ffffff" fillOpacity="0.25" />
      <rect x="225" y="111" width="7" height="9" rx="1" fill={c.pill} fillOpacity="0.5" />
      <rect x="40" y="144" width="240" height="2" rx="1" fill={c.accent} fillOpacity="0.3" />
      <rect x="152" y="26" width="16" height="5" rx="2" fill={c.pill} fillOpacity="0.85" />
      <rect x="157" y="21" width="6" height="15" rx="2" fill={c.pill} fillOpacity="0.85" />
      <circle cx="42" cy="35" r="1.5" fill={c.pill} fillOpacity="0.5" />
      <circle cx="278" cy="28" r="2" fill={c.pill} fillOpacity="0.4" />
      <circle cx="290" cy="50" r="1" fill="#ffffff" fillOpacity="0.3" />
      <circle cx="30" cy="60" r="1" fill="#ffffff" fillOpacity="0.3" />
    </svg>
  );
}

function PharmacyCard({ pharmacy: p }: { pharmacy: PharmacyData }) {
  const c = PHARMACY_COLORS[p.colorIdx];
  return (
    <div className="rounded-2xl overflow-hidden border border-white/[0.07] hover:border-blue-500/25 hover:-translate-y-1 transition-all bg-white/[0.02]">
      <PharmacyStoreSVG c={c} />
      <div className="px-5 py-4">
        <div className="font-semibold text-sm">{p.name}</div>
        <div className="text-slate-400 text-xs mt-0.5">{p.loc}</div>
        <div className="flex items-center gap-1.5 mt-2.5 text-emerald-400 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
          Live · {p.brands} {p.brands === 1 ? 'brand' : 'brands'} placed
        </div>
      </div>
    </div>
  );
}

function PharmacyOpenSlot() {
  return (
    <div className="rounded-2xl overflow-hidden border border-dashed border-blue-500/20 opacity-60 hover:opacity-80 transition-opacity">
      <svg viewBox="0 0 320 160" xmlns="http://www.w3.org/2000/svg" className="w-full" style={{ background: '#0f1a2e' }}>
        <circle cx="160" cy="80" r="90" fill="#3b82f6" fillOpacity="0.04" />
        <rect x="80" y="55" width="160" height="90" rx="4" fill="#1e3a8a" fillOpacity="0.15" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.2" strokeDasharray="6 4" />
        <rect x="144" y="72" width="32" height="8" rx="3" fill="#3b82f6" fillOpacity="0.4" />
        <rect x="156" y="60" width="8" height="32" rx="3" fill="#3b82f6" fillOpacity="0.4" />
        <text x="160" y="130" textAnchor="middle" fill="#60a5fa" fillOpacity="0.45" fontSize="10" fontFamily="system-ui, sans-serif">Your city</text>
      </svg>
      <div className="px-5 py-4">
        <div className="font-semibold text-sm text-slate-400">Your city, next</div>
        <div className="text-slate-500 text-xs mt-0.5">Be the one to onboard it</div>
        <div className="mt-2.5 text-blue-400 text-xs font-semibold">Open slot</div>
      </div>
    </div>
  );
}

export default function MagicNetworkPage() {
  const [liveStores, setLiveStores] = useState(4);
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() < 0.3) setLiveStores(prev => prev < 12 ? prev + 1 : prev);
    }, 18000);
    return () => clearInterval(interval);
  }, []);

  const tag = "text-xs font-bold tracking-widest uppercase text-cyan-400 mb-3";
  const h2cls = "text-3xl md:text-4xl font-extrabold leading-tight mb-4";
  const subcls = "text-slate-400 text-base max-w-lg";

  return (
    <>
      <ToastStack />

      <section className="min-h-screen flex items-center relative overflow-hidden pt-28 pb-20 px-6" style={{ background: 'linear-gradient(160deg,#0F172A 0%,#111827 45%,#1E293B 100%)' }}>
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle,rgba(59,130,246,0.07) 0%,transparent 68%)' }} />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle,rgba(6,182,212,0.05) 0%,transparent 68%)' }} />
        <div className="max-w-4xl mx-auto text-center relative z-10 w-full">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-semibold mb-7 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Now Recruiting Field Partners · ANZ
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold leading-tight text-white mb-6">
            Earn <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">$50 Per Pharmacy</span>.<br />Build Your Network.
          </h1>
          <p className="text-slate-300 text-lg max-w-xl mx-auto mb-10">Magic Network partners get paid to place health brands on pharmacy shelves across New Zealand and Australia. Set your own schedule. No experience required.</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href="#apply" className="px-8 py-3.5 rounded-xl font-bold text-white text-base transition-all hover:opacity-90 hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#3B82F6,#06B6D4)' }}>Join the Network</a>
            <a href="#how-it-works" className="px-8 py-3.5 rounded-xl font-semibold text-blue-300 text-base border border-blue-500/40 hover:bg-blue-500/10 transition-all hover:-translate-y-0.5">See How It Works</a>
          </div>
          <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto mt-16">
            {[{ val: '$50', lbl: 'Earned per pharmacy' }, { val: String(liveStores), lbl: 'Stores live in network' }, { val: '100+', lbl: 'Target network size' }].map((s, i) => (
              <div key={i} className="stat-card rounded-xl p-5 text-center">
                <div className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{s.val}</div>
                <div className="text-slate-400 text-xs mt-1">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="section-alt py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>How it works</div>
          <h2 className={h2cls}>Three steps. That&apos;s all it takes.</h2>
          <p className={subcls}>No sales experience, no office. Walk in, set up, snap a photo, get paid.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-14">
            {[
              { n: '01', title: 'Get Assigned a Pharmacy',    desc: 'We match you with pharmacies in your area and send brand materials and a clear brief before your visit.' },
              { n: '02', title: 'Visit and Set Up the Display', desc: 'Introduce yourself, place the products on shelf, arrange the display per our simple guide. Usually under 30 minutes.' },
              { n: '03', title: 'Submit Photos and Get Paid',  desc: 'Take 2-3 photos of the completed shelf placement, upload via our portal, and $50 hits your account within 48 hours.' },
              { n: '04', title: 'Grow Your Earnings',          desc: 'The more pharmacies you cover, the more you earn. Top partners build routes of 10-20 stores per cycle.' },
            ].map(s => (
              <div key={s.n} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 hover:border-blue-500/25 hover:-translate-y-1 transition-all">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center font-extrabold text-xs text-blue-400 mb-5">{s.n}</div>
                <div className="font-bold text-base mb-2.5">{s.title}</div>
                <div className="text-slate-400 text-sm leading-relaxed">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>Earnings calculator</div>
          <h2 className={h2cls}>See what you could make.</h2>
          <p className={subcls}>Drag the sliders and see your estimated earnings in real time.</p>
          <EarningsCalc />
        </div>
      </section>

      <section className="section-alt py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>Network activity</div>
          <h2 className={h2cls}>Real partners. Real placements.</h2>
          <p className={subcls}>Live updates from our growing network of field partners across New Zealand.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-12">
            {ACTIVITY_EVENTS.map((e, i) => (
              <div key={i} className="flex items-center gap-4 bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-4">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-500/20 flex items-center justify-center font-bold text-xs text-blue-400 shrink-0">{e.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{e.name}</div>
                  <div className="text-slate-400 text-xs mt-0.5 truncate">{e.action} · {e.time}</div>
                </div>
                <div className="text-emerald-400 font-bold text-sm shrink-0">{e.earn}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>Our early network</div>
          <h2 className={h2cls}>
            Already live in{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{PHARMACIES.length} pharmacies</span>.
          </h2>
          <p className={subcls}>We started small and built trust first. Every store in our network has been personally onboarded.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {PHARMACIES.map((p, i) => (<PharmacyCard key={i} pharmacy={p} />))}
            <PharmacyOpenSlot />
          </div>
        </div>
      </section>

      <section className="section-alt py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>Why join</div>
          <h2 className={h2cls}>Built for people who value their time.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
            {[
              { icon: '⚡', title: 'Fast Payouts',        desc: 'Payment within 48 hours of photo approval. No chasing invoices.' },
              { icon: '📍', title: 'Work Your Area',      desc: 'We match you to pharmacies near you. No long commutes.' },
              { icon: '📈', title: 'Scale At Your Pace',  desc: 'Start with 2-3 stores. Build up to 20+. You control the volume.' },
              { icon: '🤝', title: 'Backed by Magic Lab', desc: 'An AI marketing company operating across ANZ. Reliable, structured, transparent.' },
            ].map(w => (
              <div key={w.title} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 hover:border-blue-500/25 hover:-translate-y-1 transition-all">
                <div className="text-3xl mb-4">{w.icon}</div>
                <div className="font-bold text-base mb-2.5">{w.title}</div>
                <div className="text-slate-400 text-sm leading-relaxed">{w.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className={tag}>FAQ</div>
          <h2 className={h2cls}>Questions answered.</h2>
          <FaqList />
        </div>
      </section>

      <section id="apply" className="py-24 px-6" style={{ background: 'linear-gradient(160deg,#0f172a,#111827,#1a1f35)' }}>
        <div className="max-w-5xl mx-auto text-center">
          <div className={tag}>Join the network</div>
          <h2 className={h2cls}>Ready to start earning?</h2>
          <p className={subcls + ' mx-auto'}>Applications take under 3 minutes. We will be in touch within 24 hours.</p>
          <div className="max-w-lg mx-auto mt-14 bg-white/[0.03] border border-blue-500/20 rounded-2xl p-10 text-left">
            <ApplyForm />
          </div>
        </div>
      </section>

      <div className="text-center py-8 px-6 border-t border-white/[0.06] text-slate-500 text-sm">
        <strong className="text-white">Magic Network</strong> — a product of{' '}
        <Link href="/" className="text-blue-400 hover:underline">Magic Lab</Link>.
        Helping ANZ health brands reach pharmacy shelves.
      </div>
    </>
  );
}
