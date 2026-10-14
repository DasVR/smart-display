"""Talking to the wall's server on this machine: numbers and words, never
pictures or sound."""

import json
import os
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:3000"


def _token(project_dir):
    """The /api bearer token, when one is set (data/api-token or DISPLAY_API_TOKEN)."""
    env = os.environ.get("DISPLAY_API_TOKEN", "").strip()
    if env:
        return env
    try:
        with open(os.path.join(project_dir, "data", "api-token"), encoding="utf8") as f:
            return f.read().strip()
    except OSError:
        return ""


class Wall:
    def __init__(self, url=None, project_dir=None, timeout=4.0):
        self.url = (url or os.environ.get("WALL_URL") or DEFAULT_URL).rstrip("/")
        self.project_dir = project_dir or os.environ.get(
            "WALL_PROJECT_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        )
        self.timeout = timeout

    def post(self, path, body):
        """POST JSON; the answer as a dict, or None when the wall isn't there."""
        data = json.dumps(body).encode("utf8")
        req = urllib.request.Request(self.url + path, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        token = _token(self.project_dir)
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read().decode("utf8") or "{}")
        except (urllib.error.URLError, OSError, ValueError):
            return None
