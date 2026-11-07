# Pin names are passed as separate arguments, which Nushell's `-c` cannot
# receive, so these recipes run under sh and forward them with "$@".
set shell := ["sh", "-cu"]
set positional-arguments
export anchors := justfile_directory() / 'scripts' / 'anchors.nu'

[arg('module', help='Module interface path, such as neovim.completion; defaults to every module with an anchors.json')]
[doc('''
  List modules' pins from their anchors.json lock files: what each follows,
  where it stands, and whether it is frozen. Contacts no host; a module is
  resolved through the flake's check metadata, which evaluates the tracked tree.
''')]
list module='':
  nu --no-config-file "$anchors" list "$@"

[arg('module', help='Module interface path, such as neovim.completion; defaults to every module with an anchors.json')]
[doc('''
  Show the pins an update would move, by module, without changing anchors.json.
  Requires npins from the development shell and contacts the pinned sources' hosts,
  fetching new versions to compute their hashes.
''')]
outdated module='':
  nu --no-config-file "$anchors" outdated "$@"

[arg('pins', help="Pin names in the module's anchors.json; defaults to all of its pins")]
[arg('module', help='Module interface path, such as neovim.completion; defaults to every module with an anchors.json')]
[doc('''
  Update the pins of modules' anchors.json lock files with npins in lock-file mode,
  then list the changed pins and the checks a commit of them selects.
  Requires npins from the development shell and contacts the pinned sources' hosts.
  Rewrites anchors.json in place without staging it. Frozen pins are left unchanged.
''')]
update module='' *pins:
  nu --no-config-file "$anchors" update "$@"
