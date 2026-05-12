# frames_reel1.py
# Reel 1 "The Gate Opens" — frame config
# Source: Reel1_Seedance_Prompts.md
# Usage: imported by seedance_batch.py and assemble_reel.py
#
# camera_control values (Seedance 2.0 API parameter):
#   "zoom_in"    推进   — slow dolly/push toward subject
#   "zoom_out"   拉远   — pull back from subject
#   "fixed"      固定   — completely static, no camera movement
#   "handheld"   手持   — subtle handheld shake, suggests chaos/energy
#   "pan_right"  右摇   — horizontal pan left to right
#   "pan_left"   左摇   — horizontal pan right to left
#   "tilt_up"    上摇   — vertical tilt upward
#   "tilt_down"  下摇   — vertical tilt downward
#   "follow"     跟随   — camera follows subject
#   "orbit"      环绕   — camera orbits around subject

FRAMES = [
    {
        "id": "F1",
        "image": "R1_F1_jiaolou_dawn.png",
        # ⚠️ Tiananmen Gate rejected by Seedance (political content — Mao portrait).
        # ⚠️ Wumen (Meridian Gate) also rejected — "大门正面 + 红墙" pattern triggers filter.
        # Final replacement: Forbidden City corner watchtower (角楼/jiaolou) + moat reflection.
        # Zero political associations. Globally iconic. Dawn moat reflection = cinematic opening.
        # ChatGPT image generation prompt (based on classic jiaolou photography reference):
        #   "9:16 vertical ultra-cinematic photograph of the Forbidden City corner watchtower
        #    (角楼 / jiaolou), Beijing, shot from the opposite bank of the exterior moat.
        #    Camera angle: diagonal, pointing across the moat toward the tower corner where
        #    two perimeter walls meet — similar to classic jiaolou photography. Camera height:
        #    extremely low, lens 20–30cm above the water surface. The calm moat fills the
        #    lower 35% of the frame, with a near-perfect mirror reflection of the tower
        #    stretching toward the lens. Weeping willow trees (垂柳) frame the left and right
        #    edges, their branches softly blurred. Pre-dawn atmosphere: purple-to-deep-amber
        #    gradient sky, warm golden light glowing on the glazed yellow tile roofs. Thin
        #    mist layer hovers just above the moat surface. No people, no boats, no text,
        #    no political signage. Ultra-realistic cinematic photography, ultra-sharp detail
        #    on the tower. 1080x1920 pixels."
        "duration": 6,
        "aspect_ratio": "9:16",
        "camera_control": "zoom_in",   # 推进 — slow glide across moat toward tower
        "prompt": (
            "Ultra-slow gliding push-in — camera skimming 20cm above the moat surface, "
            "advancing diagonally toward the Forbidden City corner watchtower across the water. "
            "Duration: 6 seconds. Speed: extremely slow, barely perceptible movement. "
            "The mirror reflection of the tower in the calm moat stretches toward the camera, "
            "growing and clarifying as distance closes. "
            "Weeping willow branches frame both edges of the frame, swaying imperceptibly "
            "in a very gentle dawn breeze. "
            "Pre-dawn warm light: amber and orange tones glow on the glazed tile rooflines. "
            "Thin mist drifts gently across the moat surface. "
            "As camera advances, the tower rises to fill more of the upper two-thirds of the frame. "
            "PRESERVE: purple-to-amber dawn sky gradient throughout — do not shift colors or add blue. "
            "PRESERVE: mirror reflection in moat — water remains mostly still, only the gentlest ripples. "
            "PRESERVE: weeping willow silhouettes on both sides throughout. "
            "COLOR TEMPERATURE: warm 2800–3000K — do not cool at any point. "
            "Final frame: tower fills upper half, moat reflection in lower third, sky behind. "
            "Mood: dawn stillness, imperial grandeur, timeless."
        ),
        "capcut_note": None,
    },
    {
        "id": "F2",
        "image": "R1_F2_taihe_crowd.png",
        # ⚠️ Tiananmen Gate crowd rejected by Seedance (political content).
        # Replaced with Hall of Supreme Harmony (Taihedian, 太和殿) courtyard crowd.
        # ChatGPT image generation prompt:
        #   "9:16 vertical long-exposure photography inside the Forbidden City, Beijing.
        #    Locked tripod shot from ground level toward Hall of Supreme Harmony (太和殿).
        #    Hall perfectly sharp in background — red columns, golden roof, marble terrace.
        #    Tourist crowds as long-exposure horizontal motion blur streaks.
        #    Colourful flags/umbrellas as diagonal red and yellow streaks.
        #    Flat documentary 5600K daylight, slightly desaturated. 1080x1920 vertical."
        "duration": 4,  # Seedance min 4s; trim to 2s in assemble_reel.py
        "aspect_ratio": "9:16",
        "camera_control": "fixed",     # 固定镜头 — absolute lock, zero movement
        "prompt": (
            "Absolutely static locked shot — zero camera movement throughout. "
            "Animate the long-exposure crowd streaks only: warm-toned horizontal motion "
            "trails flowing left-to-right across the vast stone courtyard. "
            "Colourful flag and umbrella streaks (red, yellow) shift diagonally. "
            "The Hall of Supreme Harmony (Taihedian) in the background remains perfectly "
            "sharp and static — red columns, golden roof, white marble terrace steps. "
            "COLOR TEMPERATURE: muted warm 4000K — slightly desaturated, hazy, overcast feel. "
            "Lower contrast than surrounding frames — washed-out, snapshot quality. "
            "No cinematic grade. No dramatic lighting. Flat and ordinary feel. "
            "IMPORTANT: less saturated and less dramatic than adjacent frames, but still warm-toned. "
            "Mood: overwhelming, too crowded, chaotic — not the exclusive experience."
        ),
        "capcut_note": "⚠️  Generated 4s — trim to first 2s in assemble_reel.py / CapCut",
    },
    {
        "id": "F3",
        "image": "R1_F3_silhouette_group.png",
        "duration": 5,
        "aspect_ratio": "9:16",
        "camera_control": "zoom_in",   # 推进 — slow cinematic push toward palace
        "prompt": (
            "Slow cinematic dolly push-in from behind the silhouetted group toward "
            "the illuminated palace beyond. "
            "Camera height: 100cm, level — not tilted up or down. "
            "Speed: slow and reverent. Duration: 5 seconds. "
            "The silhouetted figures remain anchored in the lower third throughout. "
            "IMPORTANT: Do NOT animate the figures — keep them as crisp, static dark "
            "silhouettes. No body movement. "
            "As camera advances, the grand palace architecture gradually fills more of upper frame. "
            "Golden backlight intensifies very slightly as camera moves forward. "
            "PRESERVE: warm backlit contrast — silhouettes stay near-black (#1A1208). "
            "COLOR TEMPERATURE: warm 3400K — do not cool the tones. "
            "Mood: exclusive, awe-inspiring, contemplative."
        ),
        "capcut_note": None,
    },
    {
        "id": "F4",
        "image": "R1_F4_hand_pointing.png",
        "duration": 4,
        "aspect_ratio": "9:16",
        "camera_control": "fixed",     # 固定镜头 — hand stays locked, only BG breathes
        "prompt": (
            "Camera is completely static — no camera movement whatsoever. "
            "The pointing hand in the foreground holds perfectly still throughout. "
            "Background corner tower (jiaolou): very subtle slow scale-up only "
            "over 4 seconds — architecture fills slightly more of frame. "
            "Warm golden bokeh in the background shimmers gently — "
            "the blurred architectural detail breathes softly. "
            "Hand remains in sharp focus throughout entire duration. "
            "PRESERVE: shallow depth of field — hand sharp, background soft bokeh. "
            "PRESERVE: warm color temperature 4000K throughout. "
            "Mood: expert knowledge, revelation, insider access."
        ),
        "capcut_note": None,
    },
    {
        "id": "F5a",
        "image": "R1_F5a_gold_tiles.png",
        "duration": 4,  # min 4s; trim to 2s
        "aspect_ratio": "9:16",
        "camera_control": "tilt_up",   # 向上摇摄 — camera floats upward along tile surface
        "prompt": (
            "Camera tilts slowly upward along the glazed tile surface at 45-degree angle. "
            "Speed: extreme slow, floating upward movement. Duration: 2 seconds. "
            "The cylindrical tile ridges slide past the frame from bottom to top. "
            "Dragon-motif end tiles (wadang) visible in lower corners throughout. "
            "Strong raking side-light preserved — deep shadows in tile grooves "
            "animate subtly as if light source shifts very slightly. "
            "PRESERVE: warm amber tile color throughout — no color shift. "
            "PRESERVE: rich tile texture detail — keep macro sharpness. "
            "No camera shake. Smooth, floating movement. "
            "Mood: ancient craftsmanship, imperial richness."
        ),
        "capcut_note": "⚠️  Generated 4s — trim to first 2s (F5a+F5b+F5c triple quick-cut)",
    },
    {
        "id": "F5b",
        "image": "R1_F5b_dragon_carving.png",
        "duration": 4,  # min 4s; trim to 2s
        "aspect_ratio": "9:16",
        "camera_control": "pan_right",  # 向右摇摄 — pan left to right across carving
        "prompt": (
            "Slow horizontal pan left-to-right across the dragon stone carving surface. "
            "Camera height stays fixed — only horizontal movement. Duration: 2 seconds. "
            "Near-horizontal raking side-light preserved throughout — "
            "warm amber highlights sweep slowly across the dragon scales as camera pans. "
            "Shadow depth in carved crevices maintained — do not flatten shadows. "
            "Stone texture stays tactile and real throughout movement. "
            "PRESERVE: cool grey stone base (#7A7A72) with warm amber highlights. "
            "COLOR TEMPERATURE: 4500K — no warm/cool shift during movement. "
            "Mood: 600 years of history, masterful craftsmanship."
        ),
        "capcut_note": "⚠️  Generated 4s — trim to first 2s (F5a+F5b+F5c triple quick-cut)",
    },
    {
        "id": "F5c",
        "image": "R1_F5c_door_ring.png",
        "duration": 4,  # min 4s; trim to 1.5s
        "aspect_ratio": "9:16",
        "camera_control": "zoom_in",   # 推进 — very subtle scale push 100%→103%
        "prompt": (
            "Camera: very subtle slow zoom-in only — 100% to 103% scale over 1.5 seconds. "
            "No other camera movement. "
            "A single warm gold catchlight shimmers gently on the brass ring — "
            "one slow shimmer travelling left to right across the metal surface. "
            "The lion-head relief (pushou) detail remains in sharp focus. "
            "PRESERVE: deep vermillion red door color (#8B1A1A) throughout. "
            "PRESERVE: brass patina color — aged green-gold, NOT over-brightened. "
            "PRESERVE: warm 3800K tone — do not cool or brighten excessively. "
            "Mood: ancient grandeur, 600 years of imperial ceremony."
        ),
        "capcut_note": "⚠️  Generated 4s — trim to first 1.5s (F5a+F5b+F5c triple quick-cut)",
    },
    {
        "id": "F6",
        "image": "R1_F6_imperial_garden.png",
        "duration": 5,
        "aspect_ratio": "9:16",
        "camera_control": "pan_left",  # 向左摇摄 — reveal garden from right to left
        "prompt": (
            "Slow horizontal pan right-to-left, gradually revealing more of "
            "the imperial garden scene from behind the ancient pine tree. "
            "Camera height: 60cm, low angle — stays low throughout. "
            "Duration: 5 seconds. Speed: very slow, meditative. "
            "Warm amber light pools on the stone path shift gently "
            "as if a soft cloud is slowly passing overhead. "
            "Pine branches at the top of frame sway imperceptibly in a "
            "light breeze — barely visible, very gentle. "
            "PRESERVE: warm amber light on stone path (#D4860A tones). "
            "PRESERVE: color temperature 4200K — do not cool the shadows. "
            "Pavilion red walls in background stay naturally saturated. "
            "No sudden movement. Smooth, gentle, peaceful. "
            "Mood: hidden sanctuary, exclusive access, timeless peace."
        ),
        "capcut_note": None,
    },
    {
        "id": "F7",
        "image": "R1_F7_wide_taihedian.png",
        # Redesigned: extreme wide shot — tiny figures vs. overwhelming architecture.
        # Differentiates from F3 (medium close silhouettes) by dramatic scale contrast.
        # ChatGPT image generation prompt:
        #   "9:16 vertical cinematic photograph, extreme wide ultra-low angle at ground level.
        #    The Hall of Supreme Harmony (Taihedian) fills entire upper two-thirds of frame.
        #    A small group of 5-6 silhouetted figures stand at bottom center of frame —
        #    tiny against the vast marble courtyard and white balustrade terraces.
        #    Scale is overwhelmingly dramatic: palace dominates, humans are miniature.
        #    Golden hour warm light, dramatic clouds with amber and gold tones.
        #    No camera tilt — perfectly level ground-level wide shot. 1080x1920 vertical."
        "duration": 4,
        "aspect_ratio": "9:16",
        "camera_control": "zoom_in",   # 推进 — slow pull back reveals ever-greater scale
        "prompt": (
            "Extremely slow zoom-out — camera gradually pulls back to reveal "
            "the overwhelming scale of the Hall of Supreme Harmony. "
            "Duration: 4 seconds. Ultra-wide ground-level framing throughout. "
            "The 5-6 silhouetted figures at the bottom center remain perfectly still — "
            "do NOT animate or move the figures. "
            "As camera slowly pulls back, the vast marble courtyard and terraced "
            "balustrades grow wider, emphasising how small the humans are. "
            "The Hall fills the entire upper two-thirds of frame — monumental, crushing scale. "
            "Golden hour warm light sweeps subtly across the white marble balustrades. "
            "Dramatic amber and gold clouds drift very slowly overhead. "
            "PRESERVE: figures as near-black silhouettes (#1A1208) throughout. "
            "PRESERVE: warm 3200K golden hour tone — rich amber, no cool shift. "
            "Mood: awe, insignificance, once-in-a-lifetime imperial scale."
        ),
        "capcut_note": "Scale contrast with F3: F3=figures close/prominent, F7=figures tiny/dwarfed",
    },
]

# Assembly order (matches assemble_reel.py)
ASSEMBLY_ORDER = ["F1", "F2", "F3", "F4", "F5a", "F5b", "F5c", "F6", "F7"]

# Target spec
SPEC = {
    "width": 1080,
    "height": 1920,
    "aspect_ratio": "9:16",
    "format": "mp4",
}
