#!/usr/bin/env bash
# Regenerate release/packaged/icons/{icon.icns,icon.ico} from the canonical
# logo source. macOS-only (CoreGraphics + iconutil). Rerun when the logo
# changes; commit the regenerated icons.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/docs/design/assets/eido logo v1.png"
OUT="$ROOT/release/packaged/icons"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/eido-app-icons.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

swift "$ROOT/scripts/design/generate-app-icons.swift" "$SOURCE" "$WORK"

mkdir -p "$OUT"
iconutil -c icns "$WORK/icon.iconset" -o "$OUT/icon.icns"

# Pack the flat PNGs into a PNG-member .ico (supported since Vista).
node - "$WORK" "$OUT/icon.ico" <<'EOF'
const fs = require('fs')
const path = require('path')
const [work, out] = process.argv.slice(2)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const members = sizes.map((s) => ({ size: s, data: fs.readFileSync(path.join(work, `ico-${s}.png`)) }))
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(members.length, 4)
const entries = []
let offset = 6 + members.length * 16
for (const m of members) {
  const e = Buffer.alloc(16)
  e.writeUInt8(m.size === 256 ? 0 : m.size, 0)
  e.writeUInt8(m.size === 256 ? 0 : m.size, 1)
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bit depth
  e.writeUInt32LE(m.data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += m.data.length
  entries.push(e)
}
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...members.map((m) => m.data)]))
console.log(`wrote ${out} (${members.length} sizes)`)
EOF

echo "wrote $OUT/icon.icns"
