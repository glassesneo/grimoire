# The selector owns path routing, not dependency derivation. Synthetic roots
# expose wrong ownership and unsafe under-selection without freezing real modules.
use std/assert
use ../../scripts/checks.nu select-checks

def main [] {
  let metadata = {
    moduleRoots: [
      {name: parent, directory: abstractions/modules/a, infrastructure: false, affectedChecks: [module-a module-b]}
      {name: child, directory: abstractions/modules/a/child, infrastructure: false, affectedChecks: [module-child]}
      {name: infra, directory: abstractions/modules/infra, infrastructure: true, affectedChecks: []}
      {name: empty, directory: abstractions/modules/empty, infrastructure: false, affectedChecks: []}
    ]
    directoryChecks: [{name: external, directory: checks/external} {name: mechanism, directory: tests/mechanism}]
    hostChecks: [{name: host-a-darwin, directory: abstractions/hosts/a} {name: host-a-hjem, directory: abstractions/hosts/a}]
    checkNames: [module-a module-b module-child external mechanism host-a-darwin host-a-hjem formatting authoring-docs]
  }
  let all = [external host-a-darwin host-a-hjem mechanism module-a module-b module-child]
  for case in [
    {path: abstractions/modules/a/file, expected: [module-a module-b]}
    {path: abstractions/modules/a/child/file, expected: [module-child]}
    {path: abstractions/modules/ab/file, expected: $all}
    {path: abstractions/modules/empty/file, expected: []}
    {path: abstractions/modules/infra/file, expected: $all}
    {path: checks/external/default.nix, expected: [external]}
    {path: checks/unsupported/default.nix, expected: []}
    {path: checks/root-file.nix, expected: $all}
    {path: tests/mechanism/default.nix, expected: [mechanism]}
    {path: tests/unsupported/default.nix, expected: []}
    {path: tests/root-file.nix, expected: $all}
    {path: abstractions/hosts/a/default.nix, expected: [host-a-darwin host-a-hjem]}
    {path: abstractions/hosts/a-other/default.nix, expected: []}
    {path: abstractions/hosts/host/default.nix, expected: []}
    {path: docs/guide.md, expected: []}
    {path: .agents/design.md, expected: []}
    {path: .agents/config.json, expected: $all}
    {path: README.org, expected: []}
    {path: AGENTS.md, expected: []}
    {path: scripts/tool.nu, expected: $all}
    {path: unknown, expected: $all}
  ] {
    assert equal (select-checks $metadata [{status: M, path: $case.path}]) $case.expected
  }
  for path in [adapters/a extensions/a lib/a scripts/a just/a git-hooks.nix justfile flake.nix flake.lock .oxlintrc.json checks/default.nix] {
    assert equal (select-checks $metadata [{status: M, path: $path}]) $all
  }
  for status in [A D] {
    assert equal (select-checks $metadata [{status: $status, path: checks/unknown/default.nix}]) $all
    assert equal (select-checks $metadata [{status: $status, path: tests/unknown/default.nix}]) $all
    assert equal (select-checks $metadata [{status: $status, path: abstractions/modules/a/default.nix}]) $all
  }
  assert equal (select-checks $metadata [{status: M, path: abstractions/modules/a/default.nix}]) [module-a module-b]
  assert equal (select-checks $metadata [{status: M, path: abstractions/modules/a/file} {status: M, path: abstractions/modules/a/child/file}]) [module-a module-b module-child]
  assert equal (select-checks $metadata []) []
  # A known directory whose check is unavailable must not create an installable.
  let unavailable = $metadata | update directoryChecks [{name: absent, directory: checks/external}]
  assert equal (select-checks $unavailable [{status: M, path: checks/external/a}]) []
}
