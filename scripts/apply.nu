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

# Realize ATTR and keep it alive under ROOT until the procedure finishes.
# `lines` would discard the build's exit code; `str trim` propagates it.
def realize [stage: string, attr: string, root: string]: nothing -> string {
  step $stage { ^nix build --print-out-paths --out-link $root $attr | str trim }
}

def push [stage: string, target: string, ...paths: string] {
  step $stage { ^nix copy --no-check-sigs --to $'ssh-ng://($target)' ...$paths }
}

def apply-hjem [host: string, target: any, roots: string] {
  let root = flake-root
  let user = if $target == null { $env.USER } else { ^ssh $target whoami | str trim }
  let attr = $'hjemConfigurations."($user)@($host)"'

  let preflight = realize "Hjem preflight build" $'($root)#($attr).preflight' ($roots | path join hjem-preflight)
  let services = realize "Hjem service build" $'($root)#($attr).serviceApply' ($roots | path join hjem-services)
  let hjem = realize "Hjem CLI build" $'($root)#hjem' ($roots | path join hjem-cli)
  let source = ^nix flake metadata --json $root | from json | get path

  if $target != null {
    push "Hjem closure copy" $target $preflight $hjem $services
    step "flake source copy" { ^nix flake archive --no-check-sigs --to $'ssh-ng://($target)' $root }
  }

  run-on "Hjem activation" $target $"($hjem)/bin/hjem standalone switch --flake ($source) --flake-attr '($attr)' && ($services)/bin/apply"
}

def apply-darwin [host: string, target: any, roots: string] {
  let system = realize "nix-darwin build" $'(flake-root)#darwinConfigurations."($host)".system' ($roots | path join darwin-system)

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
export def hjem [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-hjem $host $target $roots }
}

# Activate the nix-darwin system of HOST.
export def darwin [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-darwin $host $target $roots }
}

# Apply nix-darwin, then Hjem; a failure stops before the next layer.
export def all [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots|
    apply-darwin $host $target $roots
    apply-hjem $host $target $roots
  }
}
