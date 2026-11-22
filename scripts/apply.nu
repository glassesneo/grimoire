# Apply Denix configurations to this machine or, over SSH, to another host.
# Invoked by the `switch` recipes of the hjem, darwin and all just modules.

def flake-root []: nothing -> string {
  const root = path self | path dirname | path dirname
  return $root
}

# Where HOST is applied: null for this machine, otherwise an SSH destination.
# An explicit --target wins; otherwise only this machine can be applied.
def resolve-target [host: string, target: string]: nothing -> any {
  if ($target | is-not-empty) { return $target }
  if $host == (^hostname -s | str trim) { return null }
  error make {msg: $"($host) is not this machine; pass --target"}
}

# Run ACTION, naming STAGE in the error when it fails. The command's own error
# and exit code follow as the cause.
def step [stage: string, action: closure]: nothing -> any {
  try { do $action } catch {|error| error make {msg: $"($stage) failed"} }
}

def run-on [stage: string, target: any, command: string] {
  step $stage {
    if $target == null {
      ^sh -c $command
    } else {
      ^ssh -t $target $command
    }
  }
}

# Realize ATTRS in one build, which evaluates the flake once, and keep them
# alive under ROOT until the procedure finishes. Returns one path per attribute,
# in their order. `lines` alone would discard the build's exit code; `str trim`
# propagates it.
def realize [stage: string, root: string, flags: list<string>, ...attrs: string]: nothing -> list<string> {
  let paths = step $stage { ^nix build --print-out-paths --out-link $root ...$flags ...$attrs | str trim | lines }
  if ($paths | length) != ($attrs | length) {
    error make {msg: $"($stage) printed ($paths | length) paths for ($attrs | length) attributes"}
  }
  $paths
}

def push [stage: string, target: string, ...paths: string] {
  step $stage { ^nix copy --no-check-sigs --to $'ssh-ng://($target)' ...$paths }
}

# Explicit candidates are immutable store sources. Keep the selected candidate
# alive for the whole switch, even if a new import replaces its persistent root.
def select-flake [source: string, roots: string]: nothing -> record {
  if ($source | is-empty) {
    return {ref: (flake-root), flags: []}
  }
  if $source !~ '^/nix/store/[0-9a-z]{32}-source$' {
    error make {msg: "--flake must be a local candidate source store path"}
  }
  step "Candidate source GC root" {
    ^nix-store --add-root ($roots | path join source) --realise $source | str trim | ignore
  }
  {ref: $"path:($source)", flags: ["--no-update-lock-file"]}
}

def apply-hjem [host: string, target: any, roots: string, flake: record] {
  let root = $flake.ref
  let user = if $target == null { $env.USER } else { ^ssh $target whoami | str trim }
  let attr = $'hjemConfigurations."($user)@($host)"'

  # The preflight realizes every closure the activation uses, `apply` included.
  let paths = realize "Hjem build" ($roots | path join hjem) $flake.flags $'($root)#($attr).preflight' $'($root)#($attr).apply' $'($root)#hjem'
  let preflight = $paths.0
  let apply = $paths.1
  let hjem = $paths.2
  let source = ^nix flake metadata --json ...$flake.flags $root | str trim | from json | get path

  if $target != null {
    push "Hjem closure copy" $target $preflight $hjem $apply
    step "flake source copy" { ^nix flake archive --no-check-sigs --to $'ssh-ng://($target)' ...$flake.flags $root }
  }

  run-on "Hjem activation" $target $"($hjem)/bin/hjem standalone switch --flake ($source) --flake-attr '($attr)' && ($apply)/bin/apply"
}

def apply-darwin [host: string, target: any, roots: string, flake: record] {
  let system = realize "nix-darwin build" ($roots | path join darwin-system) $flake.flags $'($flake.ref)#darwinConfigurations."($host)".system' | first

  if $target != null {
    push "nix-darwin closure copy" $target $system
  }

  run-on "nix-darwin activation" $target $"sudo ($system)/sw/bin/nix-env -p /nix/var/nix/profiles/system --set ($system) && sudo ($system)/activate"
}

# Hold temporary GC roots for everything realized by ACTION, then drop them.
def with-roots [action: closure] {
  let roots = mktemp -d
  try {
    do $action $roots
  } finally {
    rm --permanent --recursive --force $roots
  }
}

# Apply the Hjem configuration of the local user, or of the SSH user on a remote host.
export def hjem [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-hjem $host $target $roots (select-flake $flake $roots) }
}

# Activate the nix-darwin system of HOST.
export def darwin [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-darwin $host $target $roots (select-flake $flake $roots) }
}

# Apply nix-darwin, then Hjem; a failure stops before the next layer.
export def all [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots|
    let selected = select-flake $flake $roots
    apply-darwin $host $target $roots $selected
    apply-hjem $host $target $roots $selected
  }
}
