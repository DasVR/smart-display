"""The last 30 seconds of what the senses decided, for "that was wrong" reports.

Only numbers and words: what the camera counted (how many, where, how far,
lying or upright), what the microphone made of a piece of sound (how long it
was, the words it heard, whether they were for the wall). Never a
picture or a sound. Kept in memory only; it is sent to the wall when the
phone asks for a report, and the wall keeps it in data/senses-reports/.
"""

import json
import threading
import time

KEEP_SECONDS = 30.0


class Diary:
    def __init__(self, seconds=KEEP_SECONDS, clock=time.time):
        self.seconds = seconds
        self.clock = clock
        self._lock = threading.Lock()
        self._rows = []

    def add(self, kind, **data):
        now = self.clock()
        with self._lock:
            self._rows.append({"t": round(now, 2), "kind": kind, **data})
            cut = now - self.seconds
            while self._rows and self._rows[0]["t"] < cut:
                self._rows.pop(0)

    def rows(self, max_bytes=60000):
        """The kept rows, oldest first, dropping the oldest until they fit."""
        now = self.clock()
        with self._lock:
            rows = [r for r in self._rows if r["t"] >= now - self.seconds]
        while rows and len(json.dumps(rows)) > max_bytes:
            rows = rows[max(1, len(rows) // 10) :]
        return rows
