#!/bin/sh
# Apply the client-safe host fix to the daily desktop profile.
# Recommended: quit the DSH desktop first, run this, then reopen.
# Only two SB fragments in the live profile patch are changed; the user's other
# rows are not rewritten and no complete profile snapshot is added to the repo.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROFILE="${HOME:?}/.dsh/profiles/desktop"
RUNTIME="${HOME:?}/.dsh/plugin-packages/sb-host-runtime"

test -f "$PROFILE/package.json"
test -f "$PROFILE/cordis.patch.yml"

# Validate the exact target fragments before touching anything.
python3 - "$PROFILE/cordis.patch.yml" check <<'PY'
import sys
path, mode = sys.argv[1], sys.argv[2]
text = open(path).read()
disabled = "- id: session-controller\n  disabled: true\n"
old_row = "    - id: sb-session-controller\n      name: '@missher/sb-host-session-controller'\n"
new_row = "    - id: sb-host-session-lifecycle\n      name: '@missher/sb-host-session-lifecycle'\n"
for label, fragment in (('session-controller disabled entry', disabled), ('sb-session-controller row', old_row)):
    count = text.count(fragment)
    if count != 1:
        raise SystemExit(f'apply-profile-fix: expected exactly one {label}, found {count}; no change applied')
if mode == 'check':
    sys.exit(0)
text = text.replace(disabled, '', 1).replace(old_row, new_row, 1)
if 'sb-session-controller' in text or 'session-controller\n  disabled: true' in text:
    raise SystemExit('apply-profile-fix: replacement left an unexpected SB fragment; no change applied')
with open(path, 'w') as f:
    f.write(text)
print('patched only the SB fragments in', path)
PY

mkdir -p "$RUNTIME"
rm -rf "$RUNTIME/lifecycle"
cp -R "$ROOT/lifecycle" "$RUNTIME/lifecycle"

mkdir -p "$PROFILE/node_modules/@missher"
rm -rf "$PROFILE/node_modules/@missher/sb-host-session-lifecycle"
cp -R "$ROOT/lifecycle" "$PROFILE/node_modules/@missher/sb-host-session-lifecycle"

python3 - "$PROFILE/package.json" "$RUNTIME/lifecycle" <<'PY'
import json, sys
path, runtime = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data.setdefault('dependencies', {})['@missher/sb-host-session-lifecycle'] = 'file:' + runtime
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
PY

python3 - "$PROFILE/cordis.patch.yml" apply <<'PY'
import sys
path, mode = sys.argv[1], sys.argv[2]
text = open(path).read()
disabled = "- id: session-controller\n  disabled: true\n"
old_row = "    - id: sb-session-controller\n      name: '@missher/sb-host-session-controller'\n"
new_row = "    - id: sb-host-session-lifecycle\n      name: '@missher/sb-host-session-lifecycle'\n"
for label, fragment in (('session-controller disabled entry', disabled), ('sb-session-controller row', old_row)):
    count = text.count(fragment)
    if count != 1:
        raise SystemExit(f'apply-profile-fix: expected exactly one {label}, found {count}; no change applied')
text = text.replace(disabled, '', 1).replace(old_row, new_row, 1)
if 'sb-session-controller' in text or 'session-controller\n  disabled: true' in text:
    raise SystemExit('apply-profile-fix: replacement left an unexpected SB fragment; no change applied')
with open(path, 'w') as f:
    f.write(text)
print('patched only the SB fragments in', path)
PY
printf 'applied client-safe host lifecycle fix to %s\n' "$PROFILE"
