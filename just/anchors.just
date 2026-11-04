set shell := ["nu", "-c"]
export anchors := justfile_directory() / 'scripts' / 'anchors.nu'

[arg('module', help='Module interface path, such as neovim.completion; defaults to every module with an anchors.json')]
[doc('''
  Update the pins of modules' anchors.json lock files with npins in lock-file mode.
  Requires npins from the development shell and contacts the pinned sources' hosts.
  Rewrites anchors.json in place without staging it; a module name is resolved
  through the flake's check metadata, which evaluates the tracked tree.
''')]
update $module='':
  use {{ quote(anchors) }}; if ($env.module | is-empty) { anchors } else { anchors $env.module }
