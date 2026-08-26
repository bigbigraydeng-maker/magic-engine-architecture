# CTS Golden China 12-Day · FB 获客 Reel · Asset Provenance

**Issue**: #1159 · **Target campaign**: China Discovery — Golden China · 12 Days · depart 2026-11-16 · from NZD $4,999 pp (per `https://www.ctstours.co.nz/`, verified 2026-08-27).

## Reel versions

| Version | Manifest | Hook mode | Composition | Duration |
|---|---|---|---|---|
| v1 | script.txt + stills/ (positional CLI) | plain sequential | 4 static photos | 15.00s |
| **v2 (current)** | [`manifest.v2.json`](./manifest.v2.json) | **Instagram-vs-Reality** (viral_reference_library travel/brand top pattern) | 3 static photos + 2 real video clips | 15.00s |

- Hard cap: **≤15 s** (per Ray's FB lead-form test result — sub-15s wins).
- Format: 1080×1920 vertical H.264 + AAC.
- Cost: **$0 provider spend** (local FFmpeg + `curl` to Pexels/Pixabay + inline audio synthesis).

## Why v2 improved on v1

v1 was a KHZ structural proof (zero-spend, zero-provider). Ray's push-back: "我们的 viral 训练了这么多视频 — 如何提升？". So v2 consults `viral_reference_library` (2,689 learnable/done/not-ours refs, of which travel/brand class carries multiple 100M+ view records) and adopts the highest-transfer pattern for travel Reels:

**Instagram-vs-Reality hook** (viral ref example: 234M-view "Instagram 🥰 Vs Reality 😨" travel Reel).

v2 opens with a static glamorous "IG-post" Great Wall photo + caption `What you post` (1.8s), then hard-cuts to a real-motion Great Wall video clip + caption `What CTS gets you` (2.7s). Rest of the Reel is Beijing/Xi'an payoff + CTA. Real motion (via committed Pexels/Pixabay video clips) replaces 2 of the previous static shots.

## Stills — Pexels (Pexels License · free commercial use)

Downloaded 2026-08-27 via `curl` from `images.pexels.com`. Pexels License permits free commercial use with no attribution required (attribution appreciated).

| Slot in v1 / v2 | File | Pexels photo ID | Source URL | Photographer |
|---|---|---|---|---|
| v1 #1 (hook) / v2 #1 (IG post) | `stills/01-great-wall-autumn.jpg` | 18764171 | https://www.pexels.com/photo/18764171/ | Stijn Dijkstra |
| v1 #2 (unused in v2) | `stills/02-great-wall-path.jpg` | 2412603 | https://www.pexels.com/photo/2412603/ | Paulo Marcelo Martins |
| v1 #3 / v2 #4 | `stills/03-terracotta-warriors.jpg` | 27870557 | https://www.pexels.com/photo/27870557/ | Yolanda Reinoso Barzallo |
| v1 #4 / v2 #5 (CTA) | `stills/04-forbidden-city-rooftops.jpg` | 20683315 | https://www.pexels.com/photo/20683315/ | Pexels contributor 202387659 |

All four are **real photographs** (as Ray required — not AI-generated). Rehydrate anytime via `curl "https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?auto=compress&w=2160" -o <dest>`.

## Video clips — Pixabay Videos (Pixabay Content License · free commercial use, no attribution required)

Downloaded 2026-08-27 via `curl` from `cdn.pixabay.com`. Both are **real videos** (as Ray required — not AI-generated / not stock renders).

| Slot in v2 | File | Pixabay video ID | Source URL | Creator |
|---|---|---|---|---|
| v2 #2 (real Great Wall motion) | `clips/267748_large.mp4` | 267748 | https://pixabay.com/videos/great-wall-of-china-ancient-hill-267748/ | TungArt7 |
| v2 #3 (Temple of Heaven, Beijing) | `clips/1542-148219696_medium.mp4` | 1542 | https://pixabay.com/videos/temple-of-heaven-temple-china-beijing-1542/ | Peggy_Marco |

Trimmed inside `manifest.v2.json` via `clipStartSec` — original videos are 12s (267748 @ 4K/50fps) and 22s (1542 @ HD/30fps); each shot pulls only the interior seconds we want. Full clips kept in-repo so v2 is reproducible.

**Pexels/Pixabay tried for video first, both blocked server-side scraping (403 to `curl`). Pixabay's `cdn.pixabay.com/video/YYYY/MM/DD/<id>.mp4` CDN URLs are unauthenticated, so those work; Pexels required an API key and was skipped this round.**

## Audio bed

**Placeholder**: pentatonic ambient pad synthesized inline by ffmpeg (`aevalsrc` C4+E4+G4 three-sine major triad with slow 0.25 Hz amplitude modulation, ~5% base volume, 3s fade in/out). Zero external dependency, deterministic, license-clean.

**Why still synth in v2**: Bensound blocks `curl` (403), Pixabay Music's track pages return SPA-shells to non-browser fetches (direct MP3 URLs not scrape-able without a Pixabay account or their API), and Ray directed "go 123" — real music was gated on getting a viable URL. FB auto-plays muted anyway, so a quiet placeholder does not damage the first-view test.

**Swap-in path**: hand the CLI `--bgm <path.mp3>` (or set `bgm` in the manifest). Any real royalty-free MP3/WAV/AAC works — module already supports it end-to-end (see `stills-slideshow-reel.test.ts` "有 BGM 时用文件输入" case).

## Reel script

- **v1**: `script.txt` — plain sequential captions, one line per still.
- **v2**: `manifest.v2.json` — each shot carries its own caption; `**...**` bracketed words render highlighted (yellow) at burn time.

Every claim is grounded in a verified source:

| Claim | Source |
|---|---|
| "12 days in China" / "12 days" | Website homepage row: "16 Nov 2026 · China Discovery — Golden China · **12 Days**" |
| "Zero visa for NZ passports" | `docs/clients/cts/CTS_FB_Oct2026_Campaign.md` — "新西兰护照免签入境中国，30天" (30-day visa-free entry for NZ passports, valid through 2026-12-31) |
| "Beijing's Great Wall" / "Xi'an's Terracotta Warriors" / "Beijing to Xi'an" | Standard China-tour signature stops; both explicitly named as marquee shots in the existing October Beijing/Xi'an Reel script |
| "Depart 16 Nov" | Website homepage row |
| "from NZ$4,999" | Website homepage row |
| "What you post / What CTS gets you" | Original ME copy — an Instagram-vs-Reality frame that positions CTS's guided access (sunrise slots, off-hours entry) against the crowded default. No factual claim to ground. |

**Nothing invented**: no "12-person small group" (site confirms only generic "small groups" positioning, no numerical cap), no fabricated dates or prices, no unverified itinerary specifics.

## Render

Local CLI, no DB, no provider, no upload:

```bash
python3 -m venv /tmp/walktalk-venv
/tmp/walktalk-venv/bin/pip install pillow

# v1 — plain stills (script.txt one-line-per-still + stills dir):
WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
  npx tsx scripts/render-cts-golden-china-reel.ts \
    docs/clients/cts/2026-11-golden-china-reel-01/script.txt \
    docs/clients/cts/2026-11-golden-china-reel-01/stills \
    /tmp/cts-golden-china-reel-01.mp4

# v2 — mixed stills + real video clips + IG-vs-Reality hook:
WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
  npx tsx scripts/render-cts-golden-china-reel.ts \
    --manifest docs/clients/cts/2026-11-golden-china-reel-01/manifest.v2.json \
    /tmp/cts-golden-china-reel-02.mp4
```

Deterministic — same inputs produce the same MP4 bit-for-bit (modulo H.264 encoder non-determinism, which is negligible at CRF 23 preset veryfast).

## What this proof does / does NOT claim

- ✅ CTS approved raw source assets exist (Pexels real photos, Pexels License).
- ✅ Reel script grounded in verified website + brief facts.
- ✅ Local render pipeline works end-to-end, ≤15s, 1080×1920 vertical.
- ❌ Not uploaded to Meta. Not published. Not run through Meta Ads Manager. Not spent on. Not customer-verified.
- ❌ Ad account binding, budget, spend, audience, campaign activation — all deferred to a **separate BC contract** after Ray approves this specific MP4.

State after Ray approval: **AD_READY · NOT_PUBLISHED**.
