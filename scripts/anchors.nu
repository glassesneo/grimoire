# List, compare, and update modules' anchors, the npins lock files
# `anchors.json` that `lib/anchors.nix` reads, through npins in lock-file mode.
#
# A file belongs to the module whose directory most closely contains it, read
# from the flake's check metadata; a module is named by its interface path.
# `npins` comes from the development shell.

use ./checks.nu select-checks

def metadata []: nothing -> record {
  let system = ^nix eval --impure --raw --expr builtins.currentSystem
  ^nix eval --json --no-update-lock-file $".#lib.checks.($system)" | from json
}

def within [path: string, directory: string] {
  $path == $directory or ($path | str starts-with $"($directory)/")
}

# Every anchors.json with its owning module, or only MODULE's.
export def files [roots: list<record>, paths: list<string>, module?: string]: nothing -> list<record> {
  let owned = $paths | each {|file|
    let owners = $roots | where {|root| within $file $root.directory } | sort-by {|root| $root.directory | str length } --reverse
    {module: (if ($owners | is-empty) { null } else { $owners.0.name }), file: $file}
  }
  if $module == null { return $owned }
  if $module not-in $roots.name {
    error make --unspanned {msg: $"no module is named ($module)"}
  }
  let selected = $owned | where module == $module
  if ($selected | is-empty) {
    error make --unspanned {msg: $"module ($module) has no anchors.json"}
  }
  $selected
}

# The position a pin records: its release, its short revision, or its URL's file.
export def position [pin: record]: nothing -> string {
  match $pin.type {
    GitRelease => $pin.version
    Git => ($pin.revision | str substring 0..<7)
    Url => ($pin.url | path basename)
    _ => ($pin.hash)
  }
}

# What an update follows.
def tracks [pin: record]: nothing -> string {
  match $pin.type {
    Git => $"branch ($pin.branch)"
    GitRelease => (if $pin.pre_releases { "releases, pre-releases included" } else { "releases" })
    Url => "fixed URL"
    _ => $pin.type
  }
}

def pins-of [file: string]: nothing -> record {
  open $file | get pins
}

# Pins whose recorded position or hash differs between two `pins` records.
export def changes [module: any, before: record, after: record]: nothing -> list<record> {
  $after | transpose pin new | where {|row| ($before | get -o $row.pin) != $row.new } | each {|row|
    let old = $before | get -o $row.pin
    {
      module: $module
      pin: $row.pin
      from: (if $old == null { "" } else { position $old })
      to: (position $row.new)
    }
  }
}

def --env resolve [module?: string]: nothing -> record {
  cd (^git rev-parse --show-toplevel | str trim)
  let metadata = metadata
  let paths = glob abstractions/**/anchors.json | path relative-to $env.PWD | sort
  {metadata: $metadata, files: (files $metadata.moduleRoots $paths (if ($module | is-empty) { null } else { $module }))}
}

def run-npins [file: string, args: list<string>] {
  let result = ^npins --lock-file $file update ...$args | complete
  if $result.exit_code != 0 {
    error make --unspanned {msg: $"npins failed on ($file):\n($result.stderr | str trim)"}
  }
}

def main [] {
  help main
}

# List every module's pins, or MODULE's, from the lock files alone.
def "main list" [module?: string] {
  let target = resolve $module
  let rows = $target.files | each {|entry|
    pins-of $entry.file | transpose pin value | each {|row|
      {
        module: $entry.module
        pin: $row.pin
        tracks: (tracks $row.value)
        at: (position $row.value)
        frozen: ($row.value.frozen? | default false)
      }
    }
  } | flatten
  # Frozen pins are rare; the column appears only when one exists.
  if ($rows | any {|row| $row.frozen }) { $rows } else { $rows | reject frozen } | table --index false
}

# Show the pins of every module, or of MODULE, that an update would move, without writing.
def "main outdated" [module?: string] {
  let target = resolve $module
  let dir = mktemp --directory --tmpdir anchors.XXXXXX
  let found = try {
    $target.files | enumerate | par-each {|entry|
      let copy = $"($dir)/($entry.index).json"
      cp $entry.item.file $copy
      run-npins $copy []
      changes $entry.item.module (pins-of $entry.item.file) (pins-of $copy)
    } | flatten | sort-by module pin
  } finally {
    rm --recursive --force $dir
  }
  if ($found | is-empty) { print "every pin is current" } else { $found | table --index false }
}

# Update every pin of every module, of MODULE, or only MODULE's PINS, then name the changed pins and the checks a commit of them selects.
def "main update" [module?: string, ...pins: string] {
  if ($module | is-empty) and ($pins | is-not-empty) {
    error make --unspanned {msg: "naming pins requires a module"}
  }
  let target = resolve $module
  if ($pins | is-not-empty) {
    let known = $target.files | each {|entry| pins-of $entry.file | columns } | flatten
    let unknown = $pins | where {|pin| $pin not-in $known }
    if ($unknown | is-not-empty) {
      error make --unspanned {msg: $"module ($module) has no pin ($unknown | str join ', '); its pins are ($known | str join ', ')"}
    }
  }
  let changed = $target.files | each {|entry|
    let own = $pins | where {|pin| $pin in (pins-of $entry.file | columns) }
    if ($pins | is-not-empty) and ($own | is-empty) { return [] }
    print $"updating ($entry.file)"
    let before = pins-of $entry.file
    run-npins $entry.file $own
    changes $entry.module $before (pins-of $entry.file) | each {|row| $row | insert file $entry.file }
  } | flatten
  if ($changed | is-empty) {
    print "no pin changed"
    return
  }
  print ($changed | reject file | table --index false)
  let checks = select-checks $target.metadata ($changed.file | uniq | each {|file| {status: M, path: $file} })
  if ($checks | is-empty) {
    print "A commit of these files selects no check."
  } else {
    print "Checks a commit of these files selects:"
    $checks | each {|name| print $"  just check ($name)" } | ignore
  }
  # Selection never reaches hosts from a module, yet hosts build the new pins.
  print $"Host checks build the published configurations: ($target.metadata.hostChecks.name | uniq | str join ', ')"
}

export alias list = main list
export alias outdated = main outdated
export alias update = main update
