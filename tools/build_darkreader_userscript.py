#!/usr/bin/env python3
"""Build the tracked Dark Reader distribution from local vendor and adapter sources."""
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "packages/dark-reader/vendor/darkreader-api.min.js"
ADAPTER = ROOT / "packages/dark-reader/src/adapter.user.js"
OUT = ROOT / "packages/dark-reader/dist/dark-reader.user.js"
vendor = VENDOR.read_text()
adapter = ADAPTER.read_text()
content = vendor.rstrip() + "\n" + adapter
OUT.write_text(content)
print(f"{OUT}: {len(content.encode())} bytes; vendored sha256={sha256(VENDOR.read_bytes()).hexdigest()}")
