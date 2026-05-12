#!/usr/bin/env python3
"""
assemble_reel.py
Magic Engine — CTS Reel auto-assembly with FFmpeg

Steps:
    1. Check all MP4 clips exist (F1-F7)
    2. Trim short clips to target duration (F2=2s, F5a=2s, F5b=2s, F5c=1.5s)
    3. Normalize all clips to 1080x1920 / 30fps / H.264 / no audio
    4. Concatenate in assembly order → assembled_reel1_raw.mp4
    5. Import into CapCut for: subtitles, music, CTA brand frame

Usage (run from magic-engine root):
    python scripts/video-pipeline/assemble_reel.py \\
        --clips-dir ./output/cts-reel1 \\
        --out ./output/assembled_reel1_raw.mp4

    # Apply warm color correction to F7 (if it looks cool/blue)
    python scripts/video-pipeline/assemble_reel.py \\
        --clips-dir ./output/cts-reel1 \\
        --out ./output/assembled_reel1_raw.mp4 \\
        --fix-f7

Dependencies:
    FFmpeg must be installed and available on PATH
    Windows: winget install ffmpeg
"""

import os
import sys
import subprocess
import argparse
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from frames_reel1 import FRAMES, ASSEMBLY_ORDER

# ── Trim specs (frames generated longer than needed due to Seedance 4s minimum) ──
TRIM_SPECS = {
    "F2":  2.0,   # generated 4s, use 2s
    "F5a": 2.0,   # generated 4s, use 2s
    "F5b": 2.0,   # generated 4s, use 2s
    "F5c": 1.5,   # generated 4s, use 1.5s
}


# ── FFmpeg helpers ────────────────────────────────────────────────────────

def check_ffmpeg() -> bool:
    """Verify FFmpeg is installed and accessible."""
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        version_line = result.stdout.split("\n")[0]
        print(f"  ✅ FFmpeg: {version_line}")
        return True
    except FileNotFoundError:
        print("❌ FFmpeg not found. Install it:")
        print("   Windows: winget install ffmpeg  (then restart terminal)")
        print("   Download: https://ffmpeg.org/download.html")
        return False


def trim_clip(input_path: Path, output_path: Path, duration: float) -> bool:
    """Trim video to target duration (stream copy first, re-encode as fallback)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-t", str(duration),
        "-c:v", "copy",
        "-an",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Fallback: re-encode
        cmd[cmd.index("copy")] = "libx264"
        idx = cmd.index("-an")
        cmd.insert(idx, "fast")
        cmd.insert(idx, "-preset")
        result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def normalize_clip(input_path: Path, output_path: Path,
                   apply_warm_grade: bool = False) -> bool:
    """
    Normalize clip to 1080x1920 / 30fps / H.264 / no audio.
    apply_warm_grade: shift F7 from cool/blue toward 3400K warm tone.
    """
    vf_filters = [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
        "fps=30",
    ]

    if apply_warm_grade:
        # Simulate CapCut: color temp +25 / tint +10 / saturation +5
        vf_filters.append("eq=saturation=1.08:gamma_r=1.04:gamma_b=0.94")
        vf_filters.append("hue=h=3:s=1.05")

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", ",".join(vf_filters),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-an",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    FFmpeg stderr: {result.stderr[-500:]}")
    return result.returncode == 0


def concatenate_clips(clip_paths: list, output_path: Path) -> bool:
    """Concatenate normalized clips using FFmpeg concat demuxer (lossless copy)."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for p in clip_paths:
            f.write(f"file '{p.absolute()}'\n")
        concat_list = f.name

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list,
        "-c", "copy",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    os.unlink(concat_list)
    if result.returncode != 0:
        print(f"  FFmpeg concat stderr: {result.stderr[-500:]}")
    return result.returncode == 0


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Magic Engine — CTS Reel auto-assembly"
    )
    parser.add_argument("--clips-dir", required=True,
                        help="Directory containing F1.mp4, F2.mp4, ... from seedance_batch.py")
    parser.add_argument("--out", default="./output/assembled_reel1_raw.mp4",
                        help="Output file path (default: ./output/assembled_reel1_raw.mp4)")
    parser.add_argument("--fix-f7", action="store_true",
                        help="Apply warm color correction to F7 (color temp +25, sat +5)")
    parser.add_argument("--skip-normalize", action="store_true",
                        help="Skip normalization if clips are already 1080x1920/30fps")
    args = parser.parse_args()

    clips_dir  = Path(args.clips_dir).resolve()
    output_path = Path(args.out).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    work_dir = clips_dir / "_normalized"
    work_dir.mkdir(exist_ok=True)

    print("\n" + "="*60)
    print("🎞️  Magic Engine — CTS Reel Assembly")
    print("="*60)

    if not check_ffmpeg():
        sys.exit(1)

    # Step 1: verify all clips exist
    print("\n① Checking clips...")
    missing = []
    for fid in ASSEMBLY_ORDER:
        clip = clips_dir / f"{fid}.mp4"
        if not clip.exists():
            missing.append(fid)
            print(f"  ❌ Missing: {clip.name}")
        else:
            size_mb = clip.stat().st_size / 1_048_576
            print(f"  ✅ {clip.name} ({size_mb:.1f}MB)")

    if missing:
        print(f"\n❌ Missing clips: {missing}")
        print("   Run seedance_batch.py first to generate them.")
        sys.exit(1)

    # Step 2: trim + normalize
    normalized_clips = []
    label = "Skipping normalize (--skip-normalize)" if args.skip_normalize else "Normalizing (1080x1920 / 30fps / H.264)"
    print(f"\n② {label}...")

    for fid in ASSEMBLY_ORDER:
        src = clips_dir / f"{fid}.mp4"
        dst = work_dir / f"{fid}_norm.mp4"

        if args.skip_normalize and dst.exists():
            print(f"  ⏭  {fid}: using cached normalized clip")
            normalized_clips.append(dst)
            continue

        # Trim if needed
        clip_to_normalize = src
        if fid in TRIM_SPECS:
            trimmed = work_dir / f"{fid}_trim.mp4"
            target_dur = TRIM_SPECS[fid]
            print(f"  ✂️  {fid}: trimming to {target_dur}s...")
            if not trim_clip(src, trimmed, target_dur):
                print(f"  ❌ {fid}: trim failed")
                sys.exit(1)
            clip_to_normalize = trimmed

        # Normalize
        if args.skip_normalize:
            normalized_clips.append(clip_to_normalize)
        else:
            apply_warm = (fid == "F7" and args.fix_f7)
            warm_note = " + warm grade" if apply_warm else ""
            print(f"  🔧 {fid}: normalizing{warm_note}...")
            if not normalize_clip(clip_to_normalize, dst, apply_warm_grade=apply_warm):
                print(f"  ❌ {fid}: normalize failed")
                sys.exit(1)
            size_mb = dst.stat().st_size / 1_048_576
            print(f"  ✅ {fid}: done ({size_mb:.1f}MB)")
            normalized_clips.append(dst)

    # Step 3: concatenate
    print(f"\n③ Concatenating {len(normalized_clips)} clips...")
    print(f"   Order: {' → '.join(ASSEMBLY_ORDER)}")
    if concatenate_clips(normalized_clips, output_path):
        size_mb = output_path.stat().st_size / 1_048_576
        print(f"\n✅ Assembly complete!")
        print(f"   Output : {output_path}")
        print(f"   Size   : {size_mb:.1f}MB")
    else:
        print("\n❌ Assembly failed — check FFmpeg errors above")
        sys.exit(1)

    # Step 4: duration summary
    print("\n④ Clip duration summary:")
    total = 0.0
    for f in FRAMES:
        fid = f["id"]
        actual = TRIM_SPECS.get(fid, float(f["duration"]))
        total += actual
        note = f"  (trimmed from {f['duration']}s)" if fid in TRIM_SPECS else ""
        print(f"   {fid}: {actual}s{note}")
    print(f"   {'─'*30}")
    print(f"   Total: {total:.1f}s")

    print(f"""
┌─────────────────────────────────────────────────────┐
│  ✨ CapCut manual steps                              │
│                                                     │
│  1. Import {output_path.name:<35}    │
│  2. Add subtitles / hook text overlays              │
│  3. Import music — align F5a/b/c quick-cut to beat  │
│  4. Add CTA brand frame (#8B1A1A / Playfair Display) │
│  5. If F7 still cool: color temp +25 / tint +10     │
│  6. Export: 1080x1920 / 30fps / MP4 max quality     │
└─────────────────────────────────────────────────────┘
""")


if __name__ == "__main__":
    main()
