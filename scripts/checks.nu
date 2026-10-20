# Select from Nix-owned dependency metadata; never infer module dependencies here.
# Changes are name-status records with renames already expanded into delete/add.
# checks/<name>/ files with no available descriptor select nothing on this
# system; unknown discovery-file additions/deletions remain conservative.
def within [path: string, directory: string] {
  $path == $directory or ($path | str starts-with $"($directory)/")
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
        let checks = $metadata.directoryChecks | where {|check| within $path $check.directory }
        if ($checks | is-not-empty) { $checks.name } else if ($path | str starts-with 'checks/') and (($path | split row '/' | length) >= 3) and not (($change.status in [A D]) and ($path | path basename) == 'default.nix') { [] } else if (within $path 'abstractions/hosts') or ($path in [README.org AGENTS.md]) or (within $path docs) or ((within $path .agents) and ($path | str ends-with '.md')) { [] } else { $all }
      }
    }
  } | flatten | where {|name| $name in $all and $name not-in [formatting module-docs] } | uniq | sort
}
