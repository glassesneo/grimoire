# Select from Nix-owned dependency metadata; never infer module dependencies here.
# Changes are name-status records with renames already expanded into delete/add.
# checks/<name>/ and tests/<name>/ files with no available descriptor select nothing on this
# system; unknown discovery-file additions/deletions remain conservative.
def within [path: string, directory: string] {
  $path == $directory or ($path | str starts-with $"($directory)/")
}

# A file inside a check or test directory that does not change discovery.
def in-check-directory [change: record] {
  let path = $change.path
  (($path | str starts-with 'checks/') or ($path | str starts-with 'tests/')) and (($path | split row '/' | length) >= 3) and not (($change.status in [A D]) and ($path | path basename) == 'default.nix')
}

# A file that no check reads. A host of another system has no check here.
def unchecked [path: string] {
  (within $path 'abstractions/hosts') or ($path in [README.org AGENTS.md]) or (within $path docs) or ((within $path .agents) and ($path | str ends-with '.md'))
}

export def select-checks [metadata: record, changes: list<record>] {
  let all = $metadata.checkNames
  $changes | each {|change|
    let path = $change.path
    let structural = ($change.status in [A D]) and ($path | str starts-with 'abstractions/modules/') and ($path | path basename) == 'default.nix'
    let global = ($path in [git-hooks.nix justfile flake.nix flake.lock .oxlintrc.json checks/default.nix]) or ([adapters extensions lib scripts just] | any {|directory| within $path $directory })
    if $structural or $global { $all } else {
      let owners = $metadata.moduleRoots | where {|root| within $path $root.directory } | sort-by {|root| $root.directory | str length } --reverse
      if ($owners | is-not-empty) { $owners.0.affectedChecks } else {
        let checks = $metadata.directoryChecks ++ $metadata.hostChecks | where {|check| within $path $check.directory }
        if ($checks | is-not-empty) { $checks.name } else if (in-check-directory $change) or (unchecked $path) { [] } else { $all }
      }
    }
  } | flatten | where {|name| $name in $all and $name not-in [formatting authoring-docs] } | uniq | sort
}

# Builds the named checks of FLAKE for SYSTEM with nix-fast-build, which
# evaluates them in parallel workers sharing their common evaluation and builds
# each as soon as it is evaluated. Failed checks' logs are printed as they
# fail; an error then names every check whose evaluation or build failed. A
# run succeeds only when its result file records a successful build of every
# named check.
export def build-checks [flake: string, system: string, names: list<string>] {
  if ($names | is-empty) { return }
  # The names reach --select as JSON inside an indented string.
  let json = $names | to json --raw
  if ($json | str contains "''") or ($json | str contains '${') {
    error make {msg: $"Check names cannot be passed to nix-fast-build: ($json)"}
  }
  let select = $"checks: builtins.intersectAttrs \(builtins.listToAttrs \(map \(name: {inherit name; value = null;}\) \(builtins.fromJSON ''($json)''\)\)\) checks"
  let file = mktemp --tmpdir repository-checks.XXXXXX
  try {
    let failure = try {
      ^nix-fast-build --no-nom --eval-workers 4 --flake $"($flake)#checks.($system)" --select $select --result-file $file
      null
    } catch {|error| $error }
    # A run that fails before writing results leaves the file empty.
    let results = try { open --raw $file | from json | get results } catch { [] }
    let failed = $results | where success == false | each {|result| $result.attr } | uniq | sort
    if ($failed | is-not-empty) { error make {msg: $"Failed checks: ($failed | str join ', ')"} }
    if $failure != null { error make $failure }
    let built = $results | where {|result| $result.type == 'BUILD' and $result.success } | each {|result| $result.attr }
    let missing = $names | where {|name| $name not-in $built }
    if ($missing | is-not-empty) { error make {msg: $"nix-fast-build reported no build of: ($missing | str join ', ')"} }
  } finally {
    rm --force $file
  }
}
