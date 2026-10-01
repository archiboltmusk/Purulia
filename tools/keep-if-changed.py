#!/usr/bin/env python3
"""Keep a rebuilt data file only if it really changed and didn't shrink.

    python3 tools/keep-if-changed.py <file> [<file> ...]

For each file changed against git HEAD: if only date keys moved ("checked", "generated",
"read"), or it now holds fewer than 90% of the values it had (a source half-failed),
the committed version is restored. Used by refresh-place-data.yml before committing.
"""
import json, subprocess, sys

DATES = {'checked', 'generated', 'read'}


def strip(v):
    if isinstance(v, dict): return {k: strip(x) for k, x in v.items() if k not in DATES}
    if isinstance(v, list): return [strip(x) for x in v]
    return v


def leaves(v):
    if isinstance(v, dict): return sum(leaves(x) for x in v.values())
    if isinstance(v, list): return sum(leaves(x) for x in v)
    return 1


for path in sys.argv[1:]:
    old = subprocess.run(['git', 'show', f'HEAD:{path}'], capture_output=True, text=True)
    if old.returncode: continue  # new file: keep it
    try:
        a, b = strip(json.loads(old.stdout)), strip(json.load(open(path)))
    except (ValueError, OSError) as e:
        print(f'::warning::{path}: unreadable ({e}), keeping the committed version')
        subprocess.run(['git', 'checkout', 'HEAD', '--', path], check=True); continue
    if a == b:
        subprocess.run(['git', 'checkout', 'HEAD', '--', path], check=True)
    elif leaves(b) < 0.9 * leaves(a):
        print(f'::warning::{path}: shrank from {leaves(a)} to {leaves(b)} values, keeping the committed version')
        subprocess.run(['git', 'checkout', 'HEAD', '--', path], check=True)
    else:
        print(f'{path}: updated')
