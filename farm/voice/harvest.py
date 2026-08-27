# Tiny vocal fragments, not performances.
#
# The model wants to say things; we want a single physical noise — the sound a
# body makes, not a word it chose. So the inputs are one syllable at most, the
# length is capped hard, and anything that runs away is thrown out rather than
# trimmed, because a runaway is the model deciding to speak.
#
# Everything interesting happens later: pitch and formant come from the
# creature's mass, and the room comes from the pit. These are raw material.

import json, urllib.request, time, os, sys, struct, wave, io

URL = os.environ.get("TTS_URL", "http://localhost:8004/v1/audio/speech")
OUT = os.path.dirname(os.path.abspath(__file__)) + "/raw"
MAX_SECONDS = 1.2          # anything longer is the model talking, not grunting
TARGET_PEAK = 0.89

# One syllable, mouth-shapes rather than words — and ALWAYS punctuated. A bare
# "ugh" gives the model no reason to stop, so it runs the sampler to its 1000
# step ceiling and grinds to a second per step. The full stop is the whole
# difference between a grunt and a hang.
FRAGMENTS = {
    "hit":   ["Ugh.", "Unh.", "Hup!", "Kh.", "Guh.", "Akh!"],
    "call":  ["Ha!", "Hoo.", "Rah!", "Yah!", "Gah!", "Oi!"],
    "hurt":  ["Ah.", "Agh!", "Nh.", "Oh.", "Uh.", "Ihh."],
    "growl": ["Grr.", "Hrr.", "Khh.", "Nnh.", "Mmh.", "Vrr."],
    "die":   ["Haa.", "Uuh.", "Ohh.", "Aah.", "Hnn.", "Guh."],
}
# a spread of bodies to start from
VOICES = ["Axel.wav", "Cora.wav", "Alexander.wav", "Alice.wav"]


def trim_and_normalise(data: bytes) -> bytes | None:
    """Cut to the sound itself and bring it up to a usable level."""
    with wave.open(io.BytesIO(data), "rb") as w:
        n, sr, ch = w.getnframes(), w.getframerate(), w.getnchannels()
        raw = w.readframes(n)
    if ch != 1:
        return None
    s = struct.unpack(f"<{n}h", raw)
    peak = max(abs(v) for v in s) or 1
    gate = peak * 0.06
    first = next((i for i, v in enumerate(s) if abs(v) > gate), 0)
    last = next((i for i in range(n - 1, -1, -1) if abs(s[i]) > gate), n - 1)
    # a few ms either side so it does not click
    pad = int(sr * 0.008)
    a, b = max(0, first - pad), min(n, last + pad)
    cut = s[a:b]
    if len(cut) < sr * 0.05 or len(cut) > sr * MAX_SECONDS:
        return None
    g = (TARGET_PEAK * 32767) / peak
    out = [max(-32768, min(32767, int(v * g))) for v in cut]
    # a short fade at each end, because a hard edge is a click
    f = int(sr * 0.006)
    for i in range(min(f, len(out))):
        k = i / f
        out[i] = int(out[i] * k)
        out[-1 - i] = int(out[-1 - i] * k)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(struct.pack(f"<{len(out)}h", *out))
    return buf.getvalue()


def one(text, voice, ex, temp, seed):
    body = json.dumps({
        "model": "chatterbox", "input": text, "voice": voice,
        "response_format": "wav", "exaggeration": ex, "temperature": temp,
        "cfg_weight": 0.2, "seed": seed,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={"content-type": "application/json"})
    # a runaway must be abandoned, not waited out
    with urllib.request.urlopen(req, timeout=35) as r:
        return r.read()


def main():
    os.makedirs(OUT, exist_ok=True)
    kept = dropped = 0
    t0 = time.time()
    seed = 0
    for bank, frags in FRAGMENTS.items():
        for fi, text in enumerate(frags):
            for vi, voice in enumerate(VOICES):
                seed += 1
                ex = 1.1 + (seed % 5) * 0.22          # a spread of intensities
                temp = 0.85 + (seed % 4) * 0.16
                name = f"{bank}_{fi}_{vi}"
                try:
                    raw = one(text, voice, ex, temp, 7000 + seed)
                except Exception as e:
                    print(f"  {name}: failed {e}"); dropped += 1; continue
                cut = trim_and_normalise(raw)
                if cut is None:
                    dropped += 1
                    print(f"  {name}: rejected ({(len(raw)-44)/2/24000:.1f}s raw)")
                    continue
                open(f"{OUT}/{name}.wav", "wb").write(cut)
                kept += 1
                print(f"  {name:14} {text:5} {voice:14} {(len(cut)-44)/2/24000:.2f}s")
    print(f"\n{kept} kept, {dropped} dropped, {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
