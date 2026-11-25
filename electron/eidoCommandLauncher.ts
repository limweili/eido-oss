export const MAC_EIDO_COMMAND = '/usr/local/bin/eido'

export function renderMacEidoCommandLauncher(executable: string): string {
  const quotedExecutable = `'${executable.replaceAll("'", "'\\''")}'`
  return `#!/bin/sh\nexec ${quotedExecutable} "$@"\n`
}

export const MAC_EIDO_COMMAND_INSTALL_SCRIPT = String.raw`
set -eu
target=$1
source=$2
launcher=$3
directory=$(/usr/bin/dirname "$target")
migrate_legacy_link=false
if [ -L "$target" ]; then
  [ "$(/usr/bin/readlink "$target")" = "$source" ] || exit 73
  migrate_legacy_link=true
elif [ -e "$target" ]; then
  [ -f "$target" ] && [ -x "$target" ] && printf '%s' "$launcher" | /usr/bin/cmp -s - "$target" || exit 73
  exit 0
fi
/bin/mkdir -p "$directory"
temporary=$(/usr/bin/mktemp "$directory/.eido-launcher.XXXXXX")
trap '/bin/rm -f "$temporary"' EXIT
printf '%s' "$launcher" > "$temporary"
/bin/chmod 755 "$temporary"
if [ "$migrate_legacy_link" = true ]; then
  [ -L "$target" ] && [ "$(/usr/bin/readlink "$target")" = "$source" ] || exit 73
  /bin/mv -f "$temporary" "$target"
else
  /bin/mv -n "$temporary" "$target"
fi
[ ! -L "$target" ] && [ -f "$target" ] && [ -x "$target" ] && printf '%s' "$launcher" | /usr/bin/cmp -s - "$target"
`

export const REMOVE_MAC_EIDO_COMMAND_CANARY = String.raw`
set -eu
target=$1
[ ! -L "$target" ] && [ -f "$target" ] && printf '%s' "$2" | /usr/bin/cmp -s - "$target" || exit 73
/bin/rm -f "$target"
`
