{
  pkgs,
  lib,
  source,
}:
pkgs.runCommand "aquaskk-app-trees" {} ''
  set -euo pipefail
  source=${lib.escapeShellArg source}
  mkdir -p "$out/regular" "$out/executable"
  # Nix store files are read-only; installation uses 0644 or 0755 according
  # to the executable bit, rather than copying their store permissions.
  find -L "$source" -type f -print0 | while IFS= read -r -d "" file; do
    relative="''${file#"$source"/}"
    kind=regular
    if [ -x "$file" ]; then kind=executable; fi
    target="$out/$kind/$relative"
    mkdir -p "$(dirname "$target")"
    ln -s "$file" "$target"
  done
''
