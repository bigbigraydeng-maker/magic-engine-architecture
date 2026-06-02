/* ============================================================
   Magic Engine — homepage interactions
   ============================================================ */
(function () {
  "use strict";
  window.__ME_BUILD = 4;

  /* ---------- Nav shadow on scroll ---------- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Flywheel content ---------- */
  const STEPS = [
    {
      no: "Step 01 — Diagnose",
      title: "Find what actually moves the needle.",
      body: "Magic Engine ingests your signals — analytics, search, content, customer data — and surfaces the highest-leverage opportunities, ranked by impact. No more guessing where to start.",
      points: ["Connects to your existing data in minutes", "AI-ranked opportunity map", "Delivered in 48 hours, free"]
    },
    {
      no: "Step 02 — Prioritise",
      title: "Turn a long list into a clear plan.",
      body: "Opportunities are scored, sequenced and packaged into execution loops — so the team always knows the single most valuable thing to ship next.",
      points: ["Impact-vs-effort sequencing", "Approval items routed to the right people", "Scope locked before work begins"]
    },
    {
      no: "Step 03 — Execute",
      title: "Ship the work, not just the report.",
      body: "Prioritised work flows into active execution loops and gets done — tracked end-to-end, with progress visible to your team and your customers the whole way through.",
      points: ["Live execution tracking", "Real-time client portal view", "Nothing stalls in a backlog"]
    },
    {
      no: "Step 04 — Measure",
      title: "Show customers exactly what changed.",
      body: "Every loop closes with measurable proof — visibility lifts, actions shipped, results delivered — feeding straight back into the next diagnosis. The flywheel keeps turning.",
      points: ["Outcome dashboards per client", "Before / after proof", "Insight feeds the next loop"]
    }
  ];

  const detail = document.getElementById("fly-detail");
  const nodes = Array.from(document.querySelectorAll(".fly-node"));
  const arc = document.getElementById("fly-arc");
  const ARC_LEN = 565;

  function renderStep(i) {
    const s = STEPS[i];
    detail.innerHTML =
      '<div class="step-no">' + s.no + "</div>" +
      "<h3>" + s.title + "</h3>" +
      "<p>" + s.body + "</p>" +
      "<ul>" + s.points.map(function (p) {
        return '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' + p + "</li>";
      }).join("") + "</ul>" +
      '<div class="fly-tabs">' + STEPS.map(function (st, idx) {
        return '<button data-go="' + idx + '"' + (idx === i ? ' class="active"' : "") + ">" + st.no.split("—")[1].trim() + "</button>";
      }).join("") + "</div>";

    nodes.forEach(function (n, idx) { n.classList.toggle("active", idx === i); });

    // arc fills proportionally to step
    const frac = (i + 1) / STEPS.length;
    arc.style.transition = "stroke-dashoffset .6s cubic-bezier(.22,.61,.36,1)";
    arc.style.strokeDashoffset = String(ARC_LEN * (1 - frac));

    detail.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { setStep(+b.dataset.go, true); });
    });
  }

  let current = 0;
  let autoTimer = null;
  function setStep(i, manual) {
    current = i;
    renderStep(i);
    if (manual && autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
  nodes.forEach(function (n) {
    n.addEventListener("click", function () { setStep(+n.dataset.step, true); });
  });
  renderStep(0);

  /* ---------- Scroll-driven visibility engine ----------
     (IntersectionObserver is unreliable in this embedded context,
      so we drive everything off a throttled scroll/resize check.) */
  const watchers = [];
  function registerWatcher(el, ratio, cb) {
    watchers.push({ el: el, ratio: ratio == null ? 0.12 : ratio, cb: cb, done: false });
  }
  function inView(el, ratio) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.height === 0 && r.width === 0) return false;
    const visibleTop = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const need = Math.min(r.height * ratio, vh * 0.4);
    return r.top < vh && r.bottom > 0 && visibleTop >= Math.max(1, need);
  }
  let ticking = false;
  function runWatchers() {
    ticking = false;
    for (let i = watchers.length - 1; i >= 0; i--) {
      const w = watchers[i];
      if (w.done) { watchers.splice(i, 1); continue; }
      if (inView(w.el, w.ratio)) { w.done = true; w.cb(w.el); }
    }
  }
  function requestRun() {
    if (ticking) return;
    ticking = true;
    // NOTE: requestAnimationFrame is unreliable in this embedded context,
    // so we schedule with setTimeout instead.
    setTimeout(runWatchers, 16);
  }
  window.addEventListener("scroll", requestRun, { passive: true });
  window.addEventListener("resize", requestRun);
  // Safety net: poll for the first few seconds in case scroll never fires.
  let polls = 0;
  const pollTimer = setInterval(function () {
    runWatchers();
    if (++polls > 40 || watchers.length === 0) clearInterval(pollTimer);
  }, 200);

  /* ---------- Reveal on scroll ---------- */
  document.querySelectorAll(".reveal").forEach(function (el) {
    registerWatcher(el, 0.1, function (t) { t.classList.add("in"); });
  });

  /* ---------- Count-up numbers ---------- */
  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || "0", 10);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    const motionOff = document.documentElement.dataset.motion === "off";
    if (motionOff) { el.textContent = prefix + target.toFixed(dec) + suffix; return; }
    const dur = 1300;
    const startVal = 0;
    const start = Date.now();
    const timer = setInterval(function () {
      const t = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = target * eased;
      el.textContent = prefix + val.toFixed(dec) + suffix;
      if (t >= 1) { el.textContent = prefix + target.toFixed(dec) + suffix; clearInterval(timer); }
    }, 32);
  }
  document.querySelectorAll("[data-count]").forEach(function (el) {
    registerWatcher(el, 0.5, animateCount);
  });

  /* ---------- Dashboard progress bars / donut when visible ---------- */
  const dash = document.getElementById("dashboard");
  if (dash) {
    registerWatcher(dash, 0.25, function () {
      dash.querySelectorAll(".ftrack i").forEach(function (i) { i.style.width = i.dataset.w; });
      const donut = dash.querySelector(".donut-arc");
      if (donut) {
        setTimeout(function () {
          donut.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.22,.61,.36,1)";
          donut.style.strokeDashoffset = String(100 - 72);
        }, 60);
      }
    });
  }

  // Initial pass (and a couple of follow-ups for late layout/fonts)
  requestRun();
  window.addEventListener("load", requestRun);
  setTimeout(requestRun, 250);
  setTimeout(requestRun, 800);

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    const q = item.querySelector(".faq-q");
    const a = item.querySelector(".faq-a");
    function setOpen(open) {
      item.classList.toggle("open", open);
      a.style.maxHeight = open ? a.scrollHeight + "px" : "0px";
    }
    if (item.classList.contains("open")) setOpen(true);
    q.addEventListener("click", function () {
      const willOpen = !item.classList.contains("open");
      document.querySelectorAll(".faq-item").forEach(function (other) {
        if (other !== item) { other.classList.remove("open"); other.querySelector(".faq-a").style.maxHeight = "0px"; }
      });
      setOpen(willOpen);
    });
  });
  window.addEventListener("resize", function () {
    const open = document.querySelector(".faq-item.open .faq-a");
    if (open) open.style.maxHeight = open.scrollHeight + "px";
  });

  /* ---------- Tweaks panel ---------- */
  window.__ME_setAccent = function (a, b) {
    const r = document.documentElement.style;
    r.setProperty("--accent", a);
    r.setProperty("--accent-soft", b);
    r.setProperty("--accent-grad", "linear-gradient(135deg, " + b + " 0%, " + a + " 55%, " + a + " 100%)");
  };
})();
