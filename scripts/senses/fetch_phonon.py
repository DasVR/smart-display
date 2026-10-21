"""Fetch Phonon, the wall's voice, into the models folder (install.sh runs this).

    python fetch_phonon.py <models folder>              phonon-31m-en (Apache 2.0, 64 MB) + its voices
    HF_TOKEN=hf_... python fetch_phonon.py <folder> --40m   also phonon-40m-en (sounds better; needs a
                                                        Hugging Face account that accepted its terms;
                                                        CC BY-NC: fine at home, not for selling)

The voices are about a hundred small files (26 MB in all). Hugging Face
slows down quick anonymous downloads, so this waits and retries when told to.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://huggingface.co"
FILES = ("config.json", "model.q8.gguf", "tokenizer.json", "default-voice.safetensors")


def get(url, dest, token=""):
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as res, open(dest + ".part", "wb") as f:
                while chunk := res.read(1 << 16):
                    f.write(chunk)
            os.replace(dest + ".part", dest)
            return
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"{url}: refused ({e.code}). For the 40m model, accept its terms on huggingface.co and set HF_TOKEN.")
            if e.code != 429 and e.code < 500:
                raise
            wait = float(e.headers.get("Retry-After") or 0) or min(60, 2 ** attempt)
        except (urllib.error.URLError, TimeoutError):
            wait = min(60, 2 ** attempt)
        time.sleep(wait)
    raise SystemExit(f"could not fetch {url}")


def model(folder, name, token=""):
    for f in FILES:
        get(f"{BASE}/gradium/{name}/resolve/main/{f}", os.path.join(folder, name, f), token)
    print(f"have {name}")


def voices(folder):
    out = os.path.join(folder, "phonon-voices")
    get(f"{BASE}/gradium/phonon-voices/resolve/main/voices.jsonl", os.path.join(out, "voices.jsonl"))
    rows = [json.loads(line) for line in open(os.path.join(out, "voices.jsonl"), encoding="utf8") if line.strip()]
    rows = [r for r in rows if (r.get("language") or "en") == "en" and r.get("filename")]
    for i, r in enumerate(rows, 1):
        get(f"{BASE}/gradium/phonon-voices/resolve/main/{r['filename']}", os.path.join(out, r["filename"]))
        print(f"\rvoices {i}/{len(rows)}", end="", flush=True)
    print()


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    folder = args[0]
    model(folder, "phonon-31m-en")
    if "--40m" in argv:
        model(folder, "phonon-40m-en", os.environ.get("HF_TOKEN", "").strip())
    voices(folder)


if __name__ == "__main__":
    main(sys.argv[1:])
