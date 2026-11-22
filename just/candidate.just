set shell := ["nu", "-c"]
export candidate := justfile_directory() / 'scripts' / 'candidate.nu'

[arg('source', help='SSH destination containing the candidate checkout')]
[arg('checkout', help='Absolute path to the Git flake checkout on the source')]
[doc('''
  Import the tracked working tree (including unstaged edits) without building or applying.
  Reject non-ignored untracked files before snapshotting. Standard output is only the
  local store path. Protect the last successful import from Seiran's garbage collector;
  replacing it releases the previous candidate. Pass the desired path to switch --flake.
  Flake inputs are resolved separately at switch time.
''')]
import $source $checkout:
  @use {{ quote(candidate) }} *; import-candidate $env.source $env.checkout
