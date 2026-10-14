"""Is this sentence for the wall? "Hey wall, pause the music" is; "the wall
looks nice" isn't.

Whisper writes what it hears with punctuation and capitals, and hears "wall"
as "well" or "war" now and then right after "hey", so both are forgiven there
(and only there: "well, I think" is not a command).
"""

import re

DEFAULT_WAKE = ["hey wall", "okay wall", "ok wall"]

# what Whisper sometimes writes for "wall" straight after "hey" or "okay"
_SOUNDS_LIKE_WALL = r"(?:wall|walls|wal|waul|well|war|whoa|wow)"
_GREETING = r"(?:hey|hi|okay|ok|o\.k\.)"

# things Whisper invents in silence or music; never commands, never notes
HALLUCINATIONS = {
    "",
    "you",
    "thank you",
    "thanks for watching",
    "thank you for watching",
    "bye",
    "music",
    "applause",
    "silence",
}


def clean(text):
    """Lowercase, plain apostrophes, no punctuation but apostrophes, single spaces."""
    t = str(text or "").replace("’", "'").lower()
    t = re.sub(r"[^\w\s']", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def is_noise(text):
    """True for a piece Whisper made up out of nothing ("Thank you." in silence)."""
    t = clean(text)
    return t in HALLUCINATIONS or bool(re.fullmatch(r"(?:\[.*\]|\(.*\)|♪.*)", str(text or "").strip()))


def _phrase_pattern(phrase):
    words = clean(phrase).split()
    if not words:
        return None
    parts = []
    for i, w in enumerate(words):
        if w == "wall" and i > 0 and re.fullmatch(_GREETING, words[i - 1]):
            parts.append(_SOUNDS_LIKE_WALL)
        elif w in ("okay", "ok"):
            parts.append(r"(?:okay|ok|o k)")
        else:
            parts.append(re.escape(w))
    return r"\s+".join(parts)


def match_wake(text, wake_words=None):
    """The words after the wake phrase, or None when it doesn't start with one.

    "Hey wall, pause the music." -> "pause the music"
    "Hey wall." -> "" (a bare wake: the next thing said is the command)
    """
    raw = str(text or "").replace("’", "'").strip()
    t = clean(raw)
    for phrase in wake_words or DEFAULT_WAKE:
        pat = _phrase_pattern(phrase)
        if not pat:
            continue
        m = re.match(r"^(?:um+\s+|uh+\s+|so\s+)?" + pat + r"(?:\s+|$)", t)
        if m:
            return _after_words(raw, len(m.group(0).split()))
    return None


def _after_words(raw, count):
    """The raw text after its first `count` words (as clean() counts them).

    The wall's parser reads times like "5:30" and "p.m.", so the command is
    handed on as Whisper wrote it, only trimmed of the wake phrase and of
    trailing punctuation.
    """
    for tok in re.finditer(r"\S+", raw):
        if count <= 0:
            return raw[tok.start():].strip().rstrip(".!?,").strip()
        count -= len(clean(tok.group(0)).split())
    return ""
