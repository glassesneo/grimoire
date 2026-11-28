def flake-root []: nothing -> string {
  const root = path self | path dirname | path dirname
  return $root
}

def resolve-target [host: string, target: string]: nothing -> any {
  if ($target | is-not-empty) { return $target }
  if $host == (^hostname -s | str trim) { return null }
  error make {msg: $"($host) is not this machine; pass --target"}
}

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

# `lines` alone would discard the build's exit code; `str trim` propagates it.
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

# Keeps the selected candidate alive for the whole switch, even if a new import
# replaces its persistent root.
def select-flake [source: string, roots: string]: nothing -> record {
  if ($source | is-empty) {
    return {ref: (flake-root), flags: [], path: null}
  }
  if $source !~ '^/nix/store/[0-9a-z]{32}-source$' {
    error make {msg: "--flake must be a local candidate source store path"}
  }
  step "Candidate source GC root" {
    ^nix-store --add-root ($roots | path join source) --realise $source | str trim | ignore
  }
  {ref: $"path:($source)", flags: ["--no-update-lock-file"], path: $source}
}

def flake-source [flake: record]: nothing -> string {
  if $flake.path != null { return $flake.path }
  ^nix flake metadata --json ...$flake.flags $flake.ref | str trim | from json | get path
}

def target-user [target: any]: nothing -> string {
  if $target == null { $env.USER } else { ^ssh $target whoami | str trim }
}

def activate-darwin [target: any, system: string] {
  run-on "nix-darwin activation" $target $"sudo ($system)/sw/bin/nix-env -p /nix/var/nix/profiles/system --set ($system) && sudo ($system)/activate"
}

def activate-hjem [target: any, hjem: string, source: string, attr: string, apply: string] {
  run-on "Hjem activation (a preflight failure leaves the home unchanged; a later one can leave partial changes)" $target $"($hjem)/bin/hjem standalone switch --flake ($source) --flake-attr '($attr)' && ($apply)/bin/apply"
}

def apply-hjem [host: string, target: any, roots: string, flake: record] {
  let root = $flake.ref
  let user = target-user $target
  let attr = $'hjemConfigurations."($user)@($host)"'

  let paths = realize "Hjem build" ($roots | path join hjem) $flake.flags $'($root)#($attr).preflight' $'($root)#($attr).apply' $'($root)#hjem'
  let preflight = $paths.0
  let apply = $paths.1
  let hjem = $paths.2
  let source = flake-source $flake

  if $target != null {
    push "Hjem closure copy" $target $preflight $hjem $apply
    step "flake source copy" { ^nix flake archive --no-check-sigs --to $'ssh-ng://($target)' ...$flake.flags $root }
  }

  activate-hjem $target $hjem $source $attr $apply
}

def apply-darwin [host: string, target: any, roots: string, flake: record] {
  let system = realize "nix-darwin build" ($roots | path join darwin-system) $flake.flags $'($flake.ref)#darwinConfigurations."($host)".system' | first

  if $target != null {
    push "nix-darwin closure copy" $target $system
  }

  activate-darwin $target $system
}

def with-roots [action: closure] {
  let roots = mktemp -d
  try {
    do $action $roots
  } finally {
    rm --permanent --recursive --force $roots
  }
}

export def hjem [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-hjem $host $target $roots (select-flake $flake $roots) }
}

export def darwin [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-darwin $host $target $roots (select-flake $flake $roots) }
}

export def all [host: string, --target: string = "", --flake: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots|
    let selected = select-flake $flake $roots
    let root = $selected.ref
    let user = target-user $target
    let attr = $'hjemConfigurations."($user)@($host)"'

    let paths = realize "System and Hjem build" ($roots | path join all) $selected.flags $'($root)#darwinConfigurations."($host)".system' $'($root)#($attr).preflight' $'($root)#($attr).apply' $'($root)#hjem'
    let system = $paths.0
    let preflight = $paths.1
    let apply = $paths.2
    let hjem = $paths.3
    let source = flake-source $selected

    if $target != null {
      push "System and Hjem closure copy" $target $system $preflight $hjem $apply
      step "flake source copy" { ^nix flake archive --no-check-sigs --to $'ssh-ng://($target)' ...$selected.flags $root }
    }

    activate-darwin $target $system
    try {
      activate-hjem $target $hjem $source $attr $apply
    } catch {|error|
      error make {msg: $"($error.msg); nix-darwin is already active"}
    }
  }
}
