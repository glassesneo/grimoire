export def import-candidate [source: string, checkout: string]: nothing -> string {
  if $checkout !~ '^/' {
    error make {msg: "Candidate checkout must be an absolute path"}
  }
  # SSH joins its command arguments in a remote shell: the one data argument is
  # quoted, and the script goes on stdin rather than running checkout code.
  let quoted = "'" + ($checkout | str replace --all "'" "'\"'\"'") + "'"
  let snapshot = '
set -eu
cd "$1"
prefix=$(git rev-parse --show-prefix)
if [ -n "$prefix" ]; then
  echo "Candidate checkout must be the Git repository root" >&2
  exit 1
fi
untracked=$(git ls-files --others --exclude-standard)
if [ -n "$untracked" ]; then
  printf "%s\\n%s\\n" "Candidate checkout has untracked files:" "$untracked" >&2
  exit 1
fi
exec nix flake metadata --json --no-update-lock-file .
'
  let path = $snapshot | ^ssh -T -- $source $"sh -s -- ($quoted)" | str trim | from json | get path
  if $path !~ '^/nix/store/[0-9a-z]{32}-source$' {
    error make {msg: "Candidate metadata did not return a Git flake source store path"}
  }
  ^nix copy --from $'ssh-ng://($source)' $path | str trim | ignore
  let xdg = $env.XDG_STATE_HOME?
  let state = if ($xdg | is-empty) { $env.HOME | path join .local state } else { $xdg }
  let root = $state | path join grimoire latest-candidate
  mkdir ($root | path dirname)
  ^nix-store --add-root $root --realise $path | str trim | ignore
  $path
}
