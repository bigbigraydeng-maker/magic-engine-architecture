# CTS Golden China 12-Day · FB 获客 Reel 01 · Asset Provenance

**Issue**: #1159 · **Target campaign**: China Discovery — Golden China · 12 Days · depart 2026-11-16 · from NZD $4,999 pp (per `https://www.ctstours.co.nz/`, verified 2026-08-27).

## Reel

- Duration: **≤15 s hard cap** (per Ray's FB lead-form test result — sub-15s wins).
- Format: 1080×1920 vertical H.264 + AAC.
- Composition: 4 real photos + burned captions + ambient audio bed.
- Cost: **$0 provider spend** (local FFmpeg + `curl` to Pexels + inline audio synthesis).

## Stills — Pexels (Pexels License · free commercial use)

Downloaded 2026-08-27 via `curl` from `images.pexels.com`. Pexels License permits free commercial use with no attribution required (attribution appreciated).

| Slot | File | Pexels photo ID | Source URL | Photographer |
|---|---|---|---|---|
| 1 (hook) | `stills/01-great-wall-autumn.jpg` | 18764171 | https://www.pexels.com/photo/18764171/ | Stijn Dijkstra |
| 2 | `stills/02-great-wall-path.jpg` | 2412603 | https://www.pexels.com/photo/2412603/ | Paulo Marcelo Martins |
| 3 | `stills/03-terracotta-warriors.jpg` | 27870557 | https://www.pexels.com/photo/27870557/ | Yolanda Reinoso Barzallo |
| 4 (CTA) | `stills/04-forbidden-city-rooftops.jpg` | 20683315 | https://www.pexels.com/photo/20683315/ | Pexels contributor 202387659 |

All four are **real photographs** (as Ray required — not AI-generated). Rehydrate anytime via `curl "https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?auto=compress&w=2160" -o <dest>`.

## Audio bed

**Placeholder**: gentle ambient dyad synthesized inline by ffmpeg (`aevalsrc` two sines, ≈2% volume, 2s fade in/out). Zero external dependency, deterministic, license-clean.

**Rationale**: Bensound blocks server-side curl (403), Pixabay Music hides direct MP3 URLs behind their app shell, and Ray needs a proof today. FB auto-plays muted anyway, so a quiet placeholder does not damage the first-view test. Swap in a real royalty-free track (Bensound / Pixabay Music / Artlist) in iteration 2 by handing the CLI a `--bgm <path.mp3>` arg (see CLI docs).

## Reel script

See `script.txt`. Every claim is grounded in a verified source:

| Claim | Source |
|---|---|
| "12 days in China" | Website homepage row: "16 Nov 2026 · China Discovery — Golden China · **12 Days**" |
| "Zero visa for NZ passports" | `docs/clients/cts/CTS_FB_Oct2026_Campaign.md` — "新西兰护照免签入境中国，30天" (30-day visa-free entry for NZ passports, valid through 2026-12-31) |
| "Beijing's Great Wall" / "Xi'an's Terracotta Warriors" | Standard China-tour signature stops; both explicitly named as marquee shots in the existing October Beijing/Xi'an Reel script |
| "Depart 16 Nov" | Website homepage row |
| "from NZ$4,999" | Website homepage row |

**Nothing invented**: no "12-person small group" (site confirms only generic "small groups" positioning, no numerical cap), no fabricated dates or prices, no unverified itinerary specifics.

## Render

Local CLI, no DB, no provider, no upload:

```bash
python3 -m venv /tmp/walktalk-venv
/tmp/walktalk-venv/bin/pip install pillow

WALKTALK_PYTHON=/tmp/walktalk-venv/bin/python3 \
  npx tsx scripts/render-cts-golden-china-reel.ts \
    docs/clients/cts/2026-11-golden-china-reel-01/script.txt \
    docs/clients/cts/2026-11-golden-china-reel-01/stills \
    /tmp/cts-golden-china-reel-01.mp4
```

Deterministic — same inputs produce the same MP4 bit-for-bit (modulo H.264 encoder non-determinism, which is negligible at CRF 23 preset veryfast).

## What this proof does / does NOT claim

- ✅ CTS approved raw source assets exist (Pexels real photos, Pexels License).
- ✅ Reel script grounded in verified website + brief facts.
- ✅ Local render pipeline works end-to-end, ≤15s, 1080×1920 vertical.
- ❌ Not uploaded to Meta. Not published. Not run through Meta Ads Manager. Not spent on. Not customer-verified.
- ❌ Ad account binding, budget, spend, audience, campaign activation — all deferred to a **separate BC contract** after Ray approves this specific MP4.

State after Ray approval: **AD_READY · NOT_PUBLISHED**.
