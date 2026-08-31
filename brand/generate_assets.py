#!/usr/bin/env python3
"""Generate all missing brand assets from manifest.json via Pollinations (free, no key).

Usage: python3 brand/generate_assets.py [--all]
  --all  regenerate every asset even if the file already exists
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(BASE, "assets")
MANIFEST = os.path.join(BASE, "manifest.json")

RATIO_TO_SIZE = {
    "16:9": (768, 432),
    "1:1": (768, 768),
    "9:16": (432, 768),
    "3:4": (576, 768),
    "4:3": (768, 576),
}


def gen(prompt: str, w: int, h: int, seed: int, out: str) -> bool:
    url = "https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt)
    url += f"?width={w}&height={h}&nologo=true&seed={seed}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            data = urllib.request.urlopen(req, timeout=180).read()
            if len(data) < 1000:
                raise RuntimeError(f"tiny response ({len(data)} bytes)")
            with open(out, "wb") as f:
                f.write(data)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"    attempt {attempt + 1} failed: {e}", flush=True)
            time.sleep(8)
    return False


def main() -> int:
    force_all = "--all" in sys.argv
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    sysinst = manifest["systemInstruction"]

    todo = []
    for a in manifest["assets"]:
        out = os.path.join(ASSETS, a["filename"])
        if not force_all and os.path.exists(out) and os.path.getsize(out) > 1000:
            print(f"SKIP {a['filename']} (exists)", flush=True)
            continue
        w, h = RATIO_TO_SIZE.get(a["aspectRatio"], (768, 768))
        prompt = f"{sysinst}\n\nSubject & Scene Details: {a['prompt']}"
        todo.append((a, prompt, w, h))

    if not todo:
        print("Nothing to generate.", flush=True)
        return 0

    print(f"Generating {len(todo)} assets...", flush=True)
    ok = fail = 0
    for i, (a, prompt, w, h) in enumerate(todo, 1):
        out = os.path.join(ASSETS, a["filename"])
        seed = int(a["id"]) * 1000 + 42
        print(f"[{i}/{len(todo)}] {a['filename']} ({w}x{h}) seed={seed} ...", flush=True)
        t0 = time.time()
        if gen(prompt, w, h, seed, out):
            ok += 1
            print(f"    OK in {time.time() - t0:.0f}s", flush=True)
        else:
            fail += 1
            print(f"    FAILED: {a['filename']}", flush=True)

    print(f"DONE: {ok} ok, {fail} failed", flush=True)
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())