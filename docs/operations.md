# Operations

This file covers working-environment setup, commit automation, service ownership, and live verification. Recipe descriptions and arguments are owned by the justfiles; use `just --list --list-submodules` and `just --usage <recipe>`.

## Development environment

Enter `nix develop` before using repository commands. The shell provides the command tools, including `just`, Nushell, Bun, and bun2nix.

Entering `nix develop`, or entering through an allowed direnv environment, installs the git-hooks.nix runner and sets this repository's `core.hooksPath`. Installation replaces the configured hooks path; existing hooks are not chained. The installed tools are GC-rooted in the Git common directory. A fresh clone has no hooks until the development shell has been entered; re-enter it after changing the hook configuration or scripts. Hooks then also work outside the development shell, with access to Nix and its daemon still required.

## Commit automation

The hook works on a snapshot of the index being committed, outside the worktree. Unstaged changes and untracked files are excluded from the snapshot and left untouched, so a set of changes can be split over several commits by staging each part in turn; partial staging within a file is supported. Do not edit the worktree or index concurrently with a commit.

The hook runs repository-wide formatting and catalogue generation on the snapshot. When an automatic change would touch a path that has unstaged changes or an untracked file, the hook rejects the commit before any mutation and names those paths; run `nix fmt` and `just docs` in the worktree, restage, and commit again. Otherwise it stages all resulting non-ignored additions, modifications, and deletions, writes them to the worktree, and displays a `git diff --stat` summary of only those automatic changes. It then runs `nix flake check` on the snapshot. Successful checks allow the commit without another confirmation. Lock-file updates are disabled throughout this sequence.

Check failure blocks the commit and leaves automatic changes staged and in the worktree. Formatting or generation failure stops immediately without changing the index or worktree. Interrupted execution does not roll changes back; inspect `git status` before retrying. Git's `--no-verify` bypass remains available, and checks can still be run manually. The stateful commit runner is not itself a flake check: sandboxed checks cannot invoke nested Nix builds, and doing so would recurse.

## Hjem service ownership

Hjem-owned LaunchAgent files are owned copies, not store symlinks. Modified or unmanaged files/jobs are rejected; remove declarations to retire managed jobs. Do not manually edit managed plists or the service journal. Calling upstream standalone directly does not update services; use the repository's switch recipes.

GUI absence defers live service operations until another switch; manual launchctl disable is respected. Successful switch means registration/start requests succeeded, not application readiness. Background services are not guaranteed to return after reboot. Linux service declarations currently fail evaluation rather than silently doing nothing. Darwin-native declarations are ignored on non-Darwin systems; an empty service apply there is a no-op.

After service failure, ownership state and closure roots survive, and the next switch retries. The lifecycle and persistent state are specified in [the service reconciler](../adapters/hjem/services.py).

## Verification boundary

`nix flake check` runs checks applicable to the current system, including formatting and catalogue freshness. Checks do not rewrite repository files. A check that applies only to some platforms declares them beside its definition and is omitted elsewhere, and checks of published configurations cover the hosts of the current system. A successful check on one system does not establish another system's build or activation behavior.

Live activation and platform behavior need explicit verification outside those checks. VM snapshots are outside the repository's command interface.

## nix-secrets live verification

`just check nix-secrets` runs the sandboxed compatibility check. It validates configuration/manifest wiring and the live script's syntax, checks that a missing identity prevents plaintext publication, and rejects an ordinary directory with a forged RAM-disk marker. It does not register LaunchAgents or create disk images. The sandboxed and live checks share `tests/nix-secrets/fixture.nix`.

Inside the development shell, `nu scripts/nix-secrets-smoke.nu` runs the explicit macOS compatibility check outside the Nix sandbox. It needs a GUI login session, because the activation LaunchAgent belongs to the GUI domain. It verifies user LaunchAgent activation, fresh RAM-disk creation, reuse and recreation, consumer-visible value updates and actual file ownership/mode. It also rejects a mounted disk-backed HFS image carrying the marker. These are observations of the current package, patches, Hjem backend and macOS environment, not a general security guarantee.

Run the live check after nix-secrets updates or local patch changes; after Hjem, service wiring, environment or dependency changes that can affect activation; after a macOS upgrade; and before first use on a new machine. Run sandboxed checks first. Unrelated configuration changes do not require this live check.

The live check creates temporary dummy keys, encrypted input, a user LaunchAgent and disk images, then removes its owned test state. Its dedicated job label is separate from normal activation; it refuses an existing probe job and does not switch the normal host or use real credentials. Reboot/login recovery, real-app-specific loading/reload behavior, swap/hibernation protection and forced-interruption cleanup are not established by this check.

## SHIELD live verification

The `shield-process` and `quin` checks use the faux provider and no credentials. A live provider is verified by hand. Run `shield start` with `CMD_API_KEY` or `COMMAND_CODE_API_KEY` in its environment, or give the key as a runtime command reference in `$XDG_CONFIG_HOME/shield/pi/models.json`; restart the hub after changing its environment. Keep keys out of Nix expressions, command arguments, the store, and logs.

To verify, use an isolated `--socket` on both commands and an exact available model: open `quin --model command-code/<model-id>`, send a short prompt, detach during streaming, and reopen quin in the same directory. The same agent ID, the continued output, and the completed response establish the result; shut the hub down afterwards. This does not verify other providers.
