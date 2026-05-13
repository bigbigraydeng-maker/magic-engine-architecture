#!/usr/bin/env python3
"""
seedance_batch.py
Magic Engine — CTS Reel batch image-to-video script
Platform: Atlas Cloud (Video Studio) — Seedance 2.0 Image-to-Video API

Usage (run from magic-engine root):
    # Atlas Cloud — fast tier (recommended, ~$0.022/s)
    python scripts/video-pipeline/seedance_batch.py \\
        --images-dir ./assets/cts-reel1 \\
        --output-dir ./output/cts-reel1 \\
        --provider atlas

    # Dry-run (check config without calling API)
    python scripts/video-pipeline/seedance_batch.py \\
        --images-dir ./assets/cts-reel1 \\
        --output-dir ./output/cts-reel1 \\
        --provider atlas --dry-run

    # Retry specific frames only
    python scripts/video-pipeline/seedance_batch.py \\
        --images-dir ./assets/cts-reel1 \\
        --output-dir ./output/cts-reel1 \\
        --frame F1 F3

    # fal.ai alternative (if Atlas Cloud is unavailable)
    python scripts/video-pipeline/seedance_batch.py \\
        --images-dir ./assets/cts-reel1 \\
        --output-dir ./output/cts-reel1 \\
        --provider fal

Dependencies:
    pip install requests python-dotenv tqdm
    pip install fal-client   # only needed for --provider fal
"""

import os
import sys
import time
import argparse
import base64
import json
import requests
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# frames config is in the same directory
sys.path.insert(0, str(Path(__file__).parent))
from frames_reel1 import FRAMES, ASSEMBLY_ORDER

# ── Load env: prefer .env.local at project root (magic-engine convention) ──
_project_root = Path(__file__).parent.parent.parent
_env_local = _project_root / ".env.local"
_env_file = _project_root / ".env"

if _env_local.exists():
    load_dotenv(_env_local)
elif _env_file.exists():
    load_dotenv(_env_file)
else:
    load_dotenv()  # fallback: search CWD

# ── Constants ─────────────────────────────────────────────────────────────
MIN_DURATION   = 4    # Seedance 2.0 minimum
MAX_DURATION   = 15   # Seedance 2.0 maximum
POLL_INTERVAL  = 10   # seconds between status polls
MAX_WAIT       = 300  # seconds max wait per frame

# Atlas Cloud (Video Studio)
ATLAS_API_BASE     = "https://api.atlascloud.ai/api/v1/model"
ATLAS_MODEL_FAST   = "bytedance/seedance-2.0-fast/image-to-video"
ATLAS_MODEL_STD    = "bytedance/seedance-2.0/image-to-video"

# fal.ai (fallback)
FAL_MODEL_PRIMARY  = "fal-ai/bytedance/seedance/v2/image-to-video"
FAL_MODEL_FALLBACK = "fal-ai/bytedance/seedance/v1/pro/image-to-video"


# ── Utility functions ─────────────────────────────────────────────────────

def image_to_base64(image_path: Path) -> str:
    """Encode a local image as a base64 data URI."""
    suffix = image_path.suffix.lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
    mime = mime_map.get(suffix, "image/png")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def clamp_duration(requested: int) -> int:
    """Clamp duration to Seedance 2.0 supported range."""
    return max(MIN_DURATION, min(MAX_DURATION, requested))


def download_video(url: str, output_path: Path) -> bool:
    """Download a video from URL to local file."""
    try:
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()
        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"   ⚠️  Download failed: {e}")
        return False


def log_result(log_path: Path, frame_id: str, status: str, detail: dict):
    """Append a result entry to the JSONL generation log."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "frame": frame_id,
        "status": status,
        **detail,
    }
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ── Atlas Cloud generator ─────────────────────────────────────────────────

def generate_frame_atlas(frame: dict, images_dir: Path, output_dir: Path,
                         log_path: Path, quality: str = "fast") -> bool:
    """Submit a frame to Atlas Cloud Seedance 2.0 and download the result."""
    api_key = os.getenv("ATLAS_CLOUD_API_KEY") or os.getenv("ATLAS_API_KEY")
    if not api_key:
        print("❌ ATLAS_CLOUD_API_KEY not found. Check .env.local at magic-engine root.")
        return False

    frame_id   = frame["id"]
    img_path   = images_dir / frame["image"]
    duration   = clamp_duration(frame["duration"])
    output_mp4 = output_dir / f"{frame_id}.mp4"

    if output_mp4.exists():
        print(f"  ⏭  {frame_id} already exists, skipping")
        return True

    if not img_path.exists():
        print(f"  ❌ {frame_id}: image not found → {img_path}")
        return False

    if duration != frame["duration"]:
        print(f"  ℹ️  {frame_id}: duration adjusted {frame['duration']}s → {duration}s (Seedance minimum)")

    model = ATLAS_MODEL_FAST if quality == "fast" else ATLAS_MODEL_STD
    camera = frame.get("camera_control")
    cam_label = f" [{camera}]" if camera else ""
    print(f"\n  🎬 {frame_id}: submitting to Atlas Cloud ({model}){cam_label}...")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    input_payload = {
        "image_url": image_to_base64(img_path),
        "prompt": frame["prompt"],
        "aspect_ratio": frame.get("aspect_ratio", "9:16"),
        "duration": duration,
    }
    # camera_control is a dedicated Seedance 2.0 parameter — more reliable than
    # describing movement in the prompt alone. Both are passed for maximum fidelity.
    if camera:
        input_payload["camera_control"] = camera

    payload = {
        "model": model,
        "input": input_payload,
    }

    try:
        # Submit job
        resp = requests.post(
            f"{ATLAS_API_BASE}/generateVideo",
            headers=headers, json=payload, timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        job_id = data.get("id") or data.get("job_id") or data.get("prediction_id")

        if not job_id:
            print(f"  ❌ {frame_id}: no job_id in response: {str(data)[:300]}")
            log_result(log_path, frame_id, "error", {"reason": "no job_id", "response": str(data)[:300]})
            return False

        print(f"  ⏳ {frame_id}: job_id={job_id}, waiting for generation...")

        # Poll for completion
        start = time.time()
        video_url = None
        while time.time() - start < MAX_WAIT:
            time.sleep(POLL_INTERVAL)
            poll = requests.get(
                f"{ATLAS_API_BASE}/generateVideo/{job_id}",
                headers=headers, timeout=30
            )
            poll.raise_for_status()
            pdata = poll.json()
            status = pdata.get("status", "").lower()
            elapsed = int(time.time() - start)
            print(f"     [{elapsed}s] status: {status}")

            if status in ("succeeded", "completed", "success", "done"):
                video_url = (
                    pdata.get("output", {}).get("url") or
                    pdata.get("video_url") or
                    pdata.get("url") or
                    (pdata.get("output") if isinstance(pdata.get("output"), str) else None)
                )
                break
            elif status in ("failed", "error", "cancelled"):
                print(f"  ❌ {frame_id}: generation failed, status={status}")
                log_result(log_path, frame_id, "error",
                           {"reason": f"status={status}", "response": str(pdata)[:300]})
                return False

        if not video_url:
            print(f"  ❌ {frame_id}: timed out or no video URL returned")
            log_result(log_path, frame_id, "error", {"reason": "timeout or no video url"})
            return False

        # Download
        print(f"  ⬇️  {frame_id}: downloading...")
        if download_video(video_url, output_mp4):
            size_mb = output_mp4.stat().st_size / 1_048_576
            print(f"  ✅ {frame_id}: done ({size_mb:.1f}MB)")
            log_result(log_path, frame_id, "success",
                       {"output": str(output_mp4), "size_mb": round(size_mb, 2),
                        "provider": "atlas", "model": model})
            if frame.get("capcut_note"):
                print(f"  📋 {frame['capcut_note']}")
            return True
        return False

    except Exception as e:
        print(f"  ❌ {frame_id}: exception — {e}")
        log_result(log_path, frame_id, "error", {"reason": str(e)})
        return False


# ── fal.ai generator ──────────────────────────────────────────────────────

def generate_frame_fal(frame: dict, images_dir: Path, output_dir: Path,
                       log_path: Path, model: str = FAL_MODEL_PRIMARY) -> bool:
    """Submit a frame to fal.ai Seedance 2.0 and download the result."""
    try:
        import fal_client
    except ImportError:
        print("❌ Missing dependency: pip install fal-client")
        return False

    fal_key = os.getenv("FAL_KEY")
    if not fal_key:
        print("❌ FAL_KEY not found. Add it to .env.local")
        return False
    os.environ["FAL_KEY"] = fal_key

    frame_id   = frame["id"]
    img_path   = images_dir / frame["image"]
    duration   = clamp_duration(frame["duration"])
    output_mp4 = output_dir / f"{frame_id}.mp4"

    if output_mp4.exists():
        print(f"  ⏭  {frame_id} already exists, skipping")
        return True

    if not img_path.exists():
        print(f"  ❌ {frame_id}: image not found → {img_path}")
        return False

    if duration != frame["duration"]:
        print(f"  ℹ️  {frame_id}: duration adjusted {frame['duration']}s → {duration}s")

    camera = frame.get("camera_control")
    cam_label = f" [{camera}]" if camera else ""
    print(f"\n  🎬 {frame_id}: submitting to fal.ai ({model}){cam_label}...")

    fal_args = {
        "image_url": image_to_base64(img_path),
        "prompt": frame["prompt"],
        "aspect_ratio": frame.get("aspect_ratio", "9:16"),
        "duration": duration,
    }
    if camera:
        fal_args["camera_control"] = camera

    try:
        result = fal_client.subscribe(
            model,
            arguments=fal_args,
            with_logs=True,
            on_queue_update=lambda u: print(
                f"     queue: {u.status}" if hasattr(u, "status") else ""
            ),
        )

        video_url = None
        if isinstance(result, dict):
            video_url = (result.get("video", {}) or {}).get("url") or \
                        result.get("video_url") or result.get("url")

        if not video_url:
            print(f"  ❌ {frame_id}: no video URL in response: {str(result)[:300]}")
            log_result(log_path, frame_id, "error",
                       {"reason": "no video url", "response": str(result)[:300]})
            return False

        print(f"  ⬇️  {frame_id}: downloading...")
        if download_video(video_url, output_mp4):
            size_mb = output_mp4.stat().st_size / 1_048_576
            print(f"  ✅ {frame_id}: done ({size_mb:.1f}MB)")
            log_result(log_path, frame_id, "success",
                       {"output": str(output_mp4), "size_mb": round(size_mb, 2),
                        "provider": "fal", "model": model})
            if frame.get("capcut_note"):
                print(f"  📋 {frame['capcut_note']}")
            return True
        return False

    except Exception as e:
        error_msg = str(e)
        print(f"  ❌ {frame_id}: exception — {error_msg}")
        if model == FAL_MODEL_PRIMARY and "not found" in error_msg.lower():
            print(f"  🔄 Falling back to {FAL_MODEL_FALLBACK}...")
            return generate_frame_fal(frame, images_dir, output_dir, log_path, FAL_MODEL_FALLBACK)
        log_result(log_path, frame_id, "error", {"reason": error_msg})
        return False


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Magic Engine — CTS Reel batch Seedance 2.0 image-to-video"
    )
    parser.add_argument("--images-dir", required=True,
                        help="Folder containing source PNGs (R1_F1_dawn_gate.png, etc.)")
    parser.add_argument("--output-dir", default="./output/cts-reel1",
                        help="Output folder for MP4 files (default: ./output/cts-reel1)")
    parser.add_argument("--provider", default="atlas", choices=["atlas", "fal"],
                        help="API provider: atlas (default, recommended) or fal")
    parser.add_argument("--quality", default="fast", choices=["fast", "standard"],
                        help="Atlas Cloud quality tier (default: fast, ~$0.022/s vs $0.10/s)")
    parser.add_argument("--frame", nargs="+",
                        help="Process specific frames only, e.g. --frame F1 F3 F5a")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print config and cost estimate without calling API")
    args = parser.parse_args()

    images_dir = Path(args.images_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / "generation_log.jsonl"

    target_ids = set(args.frame) if args.frame else set(ASSEMBLY_ORDER)
    frames_to_process = [f for f in FRAMES if f["id"] in target_ids]

    if not frames_to_process:
        print(f"❌ No frames matched: {args.frame}")
        sys.exit(1)

    # Cost estimate
    total_seconds = sum(clamp_duration(f["duration"]) for f in frames_to_process)
    if args.provider == "atlas":
        rate = 0.022 if args.quality == "fast" else 0.10
        est_cost = total_seconds * rate
        model_label = f"Atlas Cloud Seedance 2.0 {'Fast' if args.quality == 'fast' else 'Standard'}"
    else:
        est_cost = len(frames_to_process) * 0.05
        model_label = "fal.ai Seedance 2.0"

    print("\n" + "="*60)
    print("🎬 Magic Engine — CTS Reel Seedance 2.0 Batch")
    print("="*60)
    print(f"  Provider  : {model_label}")
    print(f"  Images    : {images_dir}")
    print(f"  Output    : {output_dir}")
    print(f"  Frames    : {[f['id'] for f in frames_to_process]}")
    print(f"  Count     : {len(frames_to_process)}")
    print(f"  Est. cost : ~${est_cost:.2f} USD")
    print("="*60)

    if args.dry_run:
        print("\n🧪 Dry run — config preview:\n")
        for f in frames_to_process:
            d = clamp_duration(f["duration"])
            print(f"  [{f['id']}] {f['image']} | {d}s | {f['aspect_ratio']}")
            print(f"       {f['prompt'][:80]}...")
            if f.get("capcut_note"):
                print(f"       CapCut: {f['capcut_note']}")
            print()
        return

    results = {}
    for i, frame in enumerate(frames_to_process, 1):
        print(f"\n[{i}/{len(frames_to_process)}] Processing {frame['id']}...")
        if args.provider == "atlas":
            success = generate_frame_atlas(frame, images_dir, output_dir, log_path, args.quality)
        else:
            success = generate_frame_fal(frame, images_dir, output_dir, log_path)
        results[frame["id"]] = success

    print("\n" + "="*60)
    print("📊 Summary")
    print("="*60)
    ok_count = sum(1 for v in results.values() if v)
    for fid, ok in results.items():
        print(f"  {'✅' if ok else '❌'} {fid}")
    print(f"\n  Success: {ok_count} / {len(results)}")
    if ok_count < len(results):
        failed = " ".join(k for k, v in results.items() if not v)
        print(f"  Retry failed frames:")
        print(f"  python scripts/video-pipeline/seedance_batch.py ... --frame {failed}")
    print(f"\n  MP4s: {output_dir}")
    print(f"  Log:  {log_path}")
    print("\n✨ Next: python scripts/video-pipeline/assemble_reel.py --clips-dir", output_dir)
    print("="*60)


if __name__ == "__main__":
    main()
)


if __name__ == "__main__":
    main()
