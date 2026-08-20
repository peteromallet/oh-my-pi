#!/usr/bin/env python3
"""Print the current x.ai bearer token for the grok CLI proxy, refreshing via
OIDC when near expiry. Used as a command-backed apiKey in models.yml
(apiKey: "!python3 .../grok-token.py"). Writes refreshed tokens back to
~/.grok/auth.json so the grok CLI and omp stay in sync.
"""
import datetime
import json
import sys
import urllib.parse
import urllib.request

AUTH_PATH = "/Users/peteromalley/.grok/auth.json"
ISSUER_MARKER = "auth.x.ai"
REFRESH_MARGIN_SECONDS = 300
DEFAULT_EXPIRES_IN = 21600


def load_auth():
    with open(AUTH_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def find_entry(auth):
    for key, entry in auth.items():
        if ISSUER_MARKER in key and isinstance(entry, dict):
            return key, entry
    raise KeyError(f"no {ISSUER_MARKER} entry in {AUTH_PATH}")


def expires_at_ts(entry):
    raw = entry.get("expires_at")
    if not raw:
        return 0
    return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()


def refresh(entry):
    body = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": entry["refresh_token"],
            "client_id": entry["oidc_client_id"],
        }
    ).encode()
    req = urllib.request.Request(
        entry["oidc_issuer"] + "/oauth2/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read())
    entry["key"] = result["access_token"]
    if result.get("refresh_token"):
        entry["refresh_token"] = result["refresh_token"]
    entry["expires_at"] = (
        datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(seconds=result.get("expires_in", DEFAULT_EXPIRES_IN))
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return result["access_token"]


def main():
    auth = load_auth()
    _, entry = find_entry(auth)
    key = entry.get("key")
    if key and expires_at_ts(entry) > datetime.datetime.now(datetime.timezone.utc).timestamp() + REFRESH_MARGIN_SECONDS:
        sys.stdout.write(key)
        return
    new_key = refresh(entry)
    with open(AUTH_PATH, "w", encoding="utf-8") as fh:
        json.dump(auth, fh, indent=2)
    sys.stdout.write(new_key)


if __name__ == "__main__":
    main()
