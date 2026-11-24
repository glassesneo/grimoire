use std/assert
use ../../scripts/anchors.nu [files changes]

def main [] {
  let roots = [
    {name: parent, directory: abstractions/modules/a}
    {name: parent.child, directory: abstractions/modules/a/child}
    {name: sibling, directory: abstractions/modules/ab}
  ]
  let paths = [abstractions/modules/a/anchors.json abstractions/modules/a/child/anchors.json abstractions/modules/ab/anchors.json]
  assert equal (files $roots $paths) [
    {module: parent, file: abstractions/modules/a/anchors.json}
    {module: parent.child, file: abstractions/modules/a/child/anchors.json}
    {module: sibling, file: abstractions/modules/ab/anchors.json}
  ]
  assert equal (files ($roots | where name != sibling) [abstractions/modules/ab/anchors.json]) [{module: null, file: abstractions/modules/ab/anchors.json}]
  assert equal (files $roots $paths parent) [{module: parent, file: abstractions/modules/a/anchors.json}]
  assert error { files $roots $paths absent }
  assert error { files $roots [abstractions/modules/a/anchors.json] sibling }

  let git = {type: Git, branch: main, revision: "0000000aaaa", hash: h0}
  let release = {type: GitRelease, version: v1, revision: r1, hash: h1}
  let before = {kept: $git, moved: $git, released: $release}
  let after = {
    kept: $git
    moved: ($git | update revision "1111111bbbb" | update hash h2)
    released: ($release | update version v2)
    added: {type: Url, url: "https://example.org/x/file.wasm", hash: h3}
  }
  assert equal (changes m $before $after) [
    {module: m, pin: moved, from: "0000000", to: "1111111"}
    {module: m, pin: released, from: v1, to: v2}
    {module: m, pin: added, from: "", to: file.wasm}
  ]
  assert equal (changes m {kept: $git} {kept: ($git | update hash h9)}) [{module: m, pin: kept, from: "0000000", to: "0000000"}]
}
