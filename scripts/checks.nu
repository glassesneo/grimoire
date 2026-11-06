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
    let infrastructure = $metadata.moduleRoots | any {|root| $root.infrastructure and (within $path $root.directory) }
    let global = ($path in [git-hooks.nix justfile flake.nix flake.lock .oxlintrc.json checks/default.nix]) or ([adapters extensions lib scripts just] | any {|directory| within $path $directory })
    if $structural or $infrastructure or $global { $all } else {
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
# fail; an error then names every check whose evaluation or build failed.
export def build-checks [flake: string, system: string, names: list<string>] {
  if ($names | is-empty) { return }
  # The names reach --select as JSON inside an indented string.
  let json = $names | to json --raw
  if ($json | str contains "''") or ($json | str contains '${') {
    error make {msg: $"Check names cannot be passed to nix-fast-build: ($json)"}
  }
  let select = $"checks: builtins.intersectAttrs \(builtins.listToAttrs \(map \(name: {inherit name; value = null;}\) \(builtins.fromJSON ''($json)''\)\)\) checks"
  let results = mktemp --tmpdir repository-checks.XXXXXX
  try {
    try {
      ^nix-fast-build --no-nom --eval-workers 4 --flake $"($flake)#checks.($system)" --select $select --result-file $results
    } catch {|error|
      let failed = try { open --raw $results | from json | get results | where success == false | get attr | uniq | sort } catch { [] }
      if ($failed | is-empty) { error make $error }
      error make {msg: $"Failed checks: ($failed | str join ', ')"}
    }
  } finally {
    rm --force $results
  }
}
