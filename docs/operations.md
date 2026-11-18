# Operations

This file covers working-environment setup, commit and push gates, service and defaults ownership, and live verification. Recipe descriptions and arguments are owned by the justfiles; use `just --list --list-submodules` and `just --usage <recipe>`.

## Development environment

Enter `nix develop` before using repository commands. The shell provides the command tools, including `just`, Nushell, Bun, bun2nix, and npins.

Entering `nix develop`, or entering through an allowed direnv environment, installs the hooks, with prek as the git-hooks.nix runner, and sets this repository's `core.hooksPath`. Installation replaces the configured hooks path; existing hooks are not chained. The installed tools are GC-rooted in the Git common directory. A fresh clone has no hooks until the development shell has been entered; re-enter it after changing the hook configuration or scripts. Hooks then also work outside the development shell, with access to Nix and its daemon still required; prek also needs a writable cache directory (`$XDG_CACHE_HOME/prek`, by default `~/.cache/prek`).

## Check scheduling

The check runner used by commit, pre-push and `just check-full` sets its own fixed concurrency for build requests, independently of Nix's local build limit. It leaves Nix settings unchanged, so `max-jobs = 0` can continue to delegate builds to remote builders without disabling the check runner's workers.

## Commit automation

The hook works on a snapshot of the index being committed, outside the worktree. Unstaged changes and untracked files are excluded from the snapshot and left untouched, so a set of changes can be split over several commits by staging each part in turn; partial staging within a file is supported. Do not edit the worktree or index concurrently with a commit.

The hook runs repository-wide formatting and reference generation on the snapshot. When an automatic change would touch a path that has unstaged changes or an untracked file, the hook rejects the commit before any mutation and names those paths; run `nix fmt` and `just docs` in the worktree, restage, and commit again. Otherwise it stages all resulting non-ignored additions, modifications, and deletions, writes them to the worktree, and displays a `git diff --stat` summary of only those automatic changes. It then reads selection metadata from that same final snapshot and builds the checks selected by the index-to-HEAD diff, displaying their names. A failure prints each failed check's log and names the failed checks. Every run evaluates its checks anew; Nix's flake evaluation cache is not used. The initial commit uses Git's empty tree. Worktree-only changes do not affect selection. A zero-check selection skips the build. Formatting and reference freshness are excluded because automatic generation just ran. Successful checks allow the commit without another confirmation. Lock-file updates are disabled throughout this sequence.

Module changes select the module and the modules whose fixtures load it, transitively; declaration additions/deletions and unknown code paths select all checks except formatting and reference freshness. A host's changes select only that host's checks, although a host's `always` and `ifDisabled` sections also reach other hosts and published packages; only the push gate covers those effects. Designated documentation changes need no selected build. The selector's complete path rules belong to `scripts/checks.nu`.

Check failure blocks the commit without rolling automatic changes back. With the ordinary index they remain staged and in the worktree. For `git commit -a` or a path-specific commit, Git may discard its temporary index on failure: worktree fixes remain, but their staging in the persistent index is not guaranteed. Inspect `git status` and restage before retrying. Formatting or generation failure stops immediately without changing the index or worktree. Interrupted execution does not roll changes back. The stateful runners are checked with real Git and fake Nix and nix-fast-build in a sandbox; they do not run nested Nix builds there.

## Push gate

The pre-push hook runs the full gate, `scripts/gate.nu`, on temporary snapshots of the actual outgoing tip trees, not the current checkout. The gate builds every current-system check, as commit automation builds selected ones; an outdated lock file fails it. It peels tags to commits, skips deletions and tags without a commit tree, and checks each distinct tree once. Formatting and reference generation do not run: their freshness checks are part of the full gate. Failure rejects the push; temporary snapshots are removed without changing the index or worktree.

`just check-full` runs the same gate on the current tracked working tree, including unstaged tracked changes, without creating a check-output GC root. It is not a substitute for the outgoing snapshots checked by pre-push.

These are local gates. `--no-verify` or absent hooks bypass them; no server-side or CI enforcement is provided. The push gate covers outgoing tips, not every intermediate commit. Full verification means the current system's checks, not every platform's builds or activation; `scripts/gate.nu` states how they relate to `nix flake check`.

## Hjem service ownership

User services run under a dinit user instance. Hjem links their descriptions into `~/.config/dinit.d`, and one LaunchAgent, `org.hjem.dinit`, starts dinit in the GUI session; `dinitctl` reaches it without options. The repository's switch recipes apply the services step; calling upstream standalone directly places the descriptions without reloading or starting them.

TCC attributes the processes of every service to dinit. A permission a service needs, such as Accessibility, is granted to dinit (`io.github.davmac314.dinit`), whose signing identity survives rebuilds, and then holds for every service it starts.

Without a GUI session a switch only writes the agent's plist; login starts dinit with the descriptions in place. Successful switch means reload and start requests succeeded, not application readiness. A service stopped with `dinitctl stop` stays stopped until a switch changes it, makes it start with `login`, or reruns it for `restartOnSwitch`. A switch after login, or after launchd restarted dinit, brings that instance to the declarations. A home without services runs no dinit: the switch that removes the last service boots the agent out and removes it. Service declarations fail evaluation on Linux, where nothing starts dinit.

A failed service operation fails the switch after the other services are applied, and the next switch retries it. The first switch with dinit boots out and removes the LaunchAgents that the former launchd backend's journal names. The lifecycle and persistent state are specified in [the service reconciler](../abstractions/modules/services/reconcile.nu).

## Hjem defaults ownership

Declared defaults are applied by the repository's switch recipes; calling upstream standalone directly does not apply them. A switch applies defaults after services, so a restart reaches the service that switch left running; restarting a service that is not started does nothing, and it reads the values when it starts. A value changed in an application or with `defaults` is overwritten by the next switch while it stays declared. The value a declared leaf had when it was first declared is restored when its declaration is removed, even if it has since been changed elsewhere; keys of a dictionary that are not declared are left as they are. Do not edit or delete the defaults journal: it holds those values, and losing it leaves declared values in place with nothing to restore.

A failed or deferred change action stays pending and runs on a later switch; a service restart waits until dinit runs. The lifecycle and persistent state are specified in [the defaults reconciler](../abstractions/modules/defaults/reconciler/reconciler.cr).

## Real-file deployments and fonts

The Hjem switch runs the real-file deployments registered with the
[imprynt module](../abstractions/modules/imprynt/default.nix). Each deployment
commits independently: a failure stops the switch, but does not roll back earlier
deployments or Hjem activation. Keep its private state, including a retained
journal and originals after a recovery error. Correct external conflicts and
retry the switch rather than deleting state to force another installation.

To retire a deployment, leave an empty entry at its original root and state
location and apply it before removing the entry. Removing or renaming the entry
alone abandons its cleanup. Setting `fonts.enable = false` keeps that empty
entry for the fonts deployment; an ordinary switch then removes its managed
fonts while leaving manual files alone.

Verify font recognition on `seiran-vm1` with a GUI login as the target user.
Headless placement can succeed before the user's font service runs. Apply only
the imprynt step when testing fonts without activating unrelated services or
defaults: build the host's `hjemConfigurations.<user>@<host>.apply.steps.imprynt`
and run that package's `bin/apply` as the target user. This is a live mutation,
not a sandbox check. Check both AppKit's available font families and
`system_profiler SPFontsDataType` paths after addition and removal. Registry
updates are asynchronous, and an already running application's font menu may
need to be reopened or the application restarted. Do not infer recognition
from a successful file copy alone.

## AquaSKK deployment

AquaSKK is installed as real files under `~/Library/Input Methods/AquaSKK.app`
through imprynt. On the first migration from Home Manager, stop AquaSKK and
move the old app bundle to a backup outside `Library/Input Methods` before
applying: imprynt does not adopt or overwrite an existing unmanaged app.
The three Home Manager links under
`~/Library/Application Support/AquaSKK` also need the ordinary Hjem ownership
handoff. Keep the writable learning dictionary; it is not a deployment output.

Preferences are applied through Hjem defaults before the app is installed.
After switching, log out and back in to check input-source discovery. If
AquaSKK is absent, add it through System Settings → Keyboard → Input Sources.
Verify Japanese input in a GUI app and a terminal, the custom keys, dictionary
learning, and recognition after another login. A built app deployment does
not establish these macOS behaviors.

Disabling `aquaskk.enable` keeps the empty app deployment for retirement on the
next switch. Apply that disabled declaration before removing or renaming the
deployment. Retirement leaves the learning dictionary in place.

## OmniWM deployment

OmniWM's Hjem step writes a mutable `settings.toml` before the services step.
The app needs to rewrite this file; do not replace it with a Nix-store
symlink. Each switch reapplies the declared settings over the pinned defaults,
rather than retaining GUI edits, and the upstream deployment script keeps the
previous differing file as `settings.toml.bak`. Disabling the module stops its
service but leaves this writable settings file in place.

Before migrating from Home Manager, stop and retire its OmniWM LaunchAgent
(`org.nix-community.home.omniwm`) so it cannot compete with the dinit service.
The Hjem service reconciler does not own Home Manager's jobs. Hand off any old
managed application link through the ordinary Hjem ownership migration.
Grant Accessibility to dinit as described above. If Displays have separate
Spaces was changed, log out and back in before checking window management.

Verify ordinary Command shortcuts, entry and release of the held WM layer,
repeated navigation with and without left Shift, and isolation from the
terminal's pane bindings. A successful Kanata syntax check and settings build
do not verify physical key timing, TCC access, or OmniWM's GUI behavior.

## BetterTouchTool presets

Hjem places the exported preset at
`~/.config/bettertouchtool/Default.bttpreset`; it does not import it or replace
BetterTouchTool's writable database. Restore it manually through BetterTouchTool's
preset import UI and review the confirmation before applying. The export includes
exportable general settings as well as triggers, so an import can affect app-wide
behavior. Import and trigger behavior still need live verification.

Edit in the GUI, then export the `Default` preset as uncompressed JSON with
exportable general settings included. Review the export for scripts, credentials
and machine-specific paths before replacing
`abstractions/modules/bettertouchtool/presets/default.bttpreset`.
The running app's AppleScript `export_preset` command can also write this snapshot
without enabling the CLI Socket Server. The bundled `bttcli` needs that server
enabled and BetterTouchTool restarted before it can export. Neither method is
run automatically by a switch; GUI-only changes remain until an explicit import.

## AI MOP workbench

Run `nix run .#ai-mop` without activating a host. Supply the key through
`AI_MOP_API_KEY`, or set `AI_MOP_API_KEY_FILE` to an already decrypted file.
The workbench reads the file at runtime; it does not decrypt, issue or rotate
keys. Its OpenAI providers are `ai-mop-responses` and `ai-mop-chat`; its
Anthropic provider is `ai-mop-anthropic`. Select a route and model with Pi's
`--provider` and `--model`, or `/model` in the TUI.

For OpenAI models with both tools and reasoning enabled, use the Responses route:

```sh
nix run .#ai-mop -- --provider ai-mop-responses --model gpt-6.2-sol
```

The Chat route is for explicit compatibility trials. The proxy can reject tools
combined with reasoning on Chat Completions even when the same model supports
them on Responses. Changing the client serializer does not bypass that server
restriction. Select the provider explicitly when selecting a model shared by
several routes; a bare model ID can be ambiguous.

Model names carry a route label, and the TUI status line shows the selected
route and thinking level. The model picker contains candidates from the pinned
Pi catalog, not a verified AI MOP availability list. `/mop-models openai` requests
the server's model IDs; listing does not verify inference support.
`/mop-models anthropic <model-id>` retrieves individual model metadata. The
tested Anthropic proxy rejects the listing endpoint; requesting it without an
ID reports that limitation and points to the individual lookup.
Catalog capabilities and limits are starting metadata, not measurements of the
proxy. Pi can also try an unknown model ID with fallback metadata and a warning.
Use `AI_MOP_MODELS_FILE` to supply a Pi `models.json` profile at startup when
testing new metadata, sampling parameters or compatibility overrides.
`AI_MOP_OPENAI_BASE_URL` and `AI_MOP_ANTHROPIC_BASE_URL` override the SDK base
URLs; the Anthropic SDK appends `/v1/messages` itself.

Each launch uses temporary configuration, excluding inherited Pi resources,
MCP, skills, templates and project context files. Only the direct `echo` and
`sha256` test tools are active. This is configuration isolation, not an OS
sandbox; explicit Pi CLI options can change it. Settings changed within that
launch are temporary. `--no-tools` disables the test tools explicitly; the
launcher supplies their names as defaults rather than forced CLI arguments.
Automatic retries, compaction, cache warming and background catalog updates
are disabled.

Sessions, including prompts, responses and tool results, are saved separately
under `${XDG_STATE_HOME:-~/.local/state}/grimoire/ai-mop/sessions`.
`AI_MOP_STATE_DIR` changes the workbench state root; `--no-session` disables
session persistence. `/mop-status` shows the selected route and the last
request's endpoint, parameters, declared tool names, HTTP status when available,
elapsed time and usage. Recognized proxy incompatibilities produce a recovery
hint in the UI or stderr and in the request summary. These hints do not change
tools, thinking or routes, or resend a request automatically.
Request summaries are also saved as custom session entries without prompt
bodies, tool schemas or authentication headers. Token counts are provider-reported through
Pi; zero catalog costs are placeholders, not measured AI MOP charges.

For scripted trials, `--mode json -p '<prompt>'` exposes Pi's events. Inspect the
assistant's `stopReason` and tool results: a zero process exit status alone
does not establish a successful model request. Check that usable content was
parsed as well. The workbench tests Pi's API integration, not every operation
or wire-level detail of AI MOP.

The Anthropic route remains an unadapted compatibility trial. The tested proxy
accepts ordinary text, but rejects `tools`, `thinking` (including an explicit
disabled value) and `cache_control`. Its streaming response also omits the named
SSE events Pi expects. Disabling tools and thinking alone is therefore not enough
for the current route. A text-only transport adapter could normalize the wire
format, but would not supply the missing tool or reasoning controls. No such
adapter or silent field removal is enabled by this workbench.

## Verification boundary

The full gate runs every check applicable to the current system, including formatting and reference freshness. The published outputs and the configurations of the current system's hosts are evaluated, not built, as `checks/default.nix` states; their build failures surface only when they are built or applied. Checks do not rewrite repository files. A check that applies only to some platforms declares them beside its definition and is omitted elsewhere, and checks of published configurations cover the hosts of the current system. A successful check on one system does not establish another system's build or activation behavior.

Live activation and platform behavior need explicit verification outside those checks. Use `seiran-vm1` for service verification, with an isolated home and dedicated probe labels; do not register test jobs on the workstation. Check there the agent's bootstrap and replacement, the addition, change, removal and retry of services, a switch without a GUI session, the retirement of the former launchd jobs, and the TCC grants of services started by dinit. Check there too that secrets are activated by a switch without a GUI session and by the first SSH session after a reboot. Verify defaults there too with a dedicated probe domain; values go to the preferences of the user running the apply, whatever home it is given: first declaration of present and absent keys, including leaves inside existing and missing dictionaries, overwrite after an outside change, restoration on removal, and each change action. GUI cases require an available GUI login session. VM snapshots are outside the repository's command interface.

## nix-secrets live verification

`just check module-nix-secrets` runs the sandboxed compatibility check, the nix-secrets module's own cases. It validates configuration/manifest wiring and the live script's syntax, checks that a missing identity prevents plaintext publication, and rejects an ordinary directory with a forged RAM-disk marker. It does not start dinit, register LaunchAgents or create disk images. The sandboxed and live checks activate the same probe, `abstractions/modules/nix-secrets/probe.nix`; the live check composes it with the flake's `lib.compose` in `scripts/nix-secrets-smoke.nix`.

On `seiran-vm1`, inside the development shell, `nu scripts/nix-secrets-smoke.nu` runs the explicit macOS compatibility check outside the Nix sandbox. It needs a GUI login session, because the probe's dinit LaunchAgent belongs to the GUI domain. It verifies activation by a dinit service, fresh RAM-disk creation, reuse and recreation by a new dinit instance, consumer-visible value updates and actual file ownership/mode. It also rejects a mounted disk-backed HFS image carrying the marker. These are observations of the current package, patches, Hjem backend and macOS environment, not a general security guarantee.

Run the live check after nix-secrets updates or local patch changes; after Hjem, service wiring, environment or dependency changes that can affect activation; after a macOS upgrade; and before first use on a new machine. Run sandboxed checks first. Unrelated configuration changes do not require this live check.

The live check creates temporary dummy keys, encrypted input, a dinit LaunchAgent and disk images, then removes its owned test state. Its dedicated agent label is separate from normal activation; it refuses an existing probe job and does not switch the normal host or use real credentials. Reboot/login recovery, real-app-specific loading/reload behavior, swap/hibernation protection and forced-interruption cleanup are not established by this check.
