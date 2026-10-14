# SHIELD and quin

Darwin-only manual hub and attachable Pi client. No host activation or service registration is required; the existing harness is unchanged.

```sh
nix run .#shield -- start
nix run .#quin -- --mock
# Close quin with Ctrl+Q, then run it again in the same directory.
nix run .#shield -- list
nix run .#shield -- stop <agent-id>
nix run .#shield -- shutdown
```

Use `--socket /absolute/private-directory/hub.sock` on **both** commands to isolate a test hub. quin never starts a hub automatically. A live/mock or explicit model mismatch is an error; use a different directory or socket instead of silently replacing an agent. Wait for the old hub process to exit before starting a replacement after shutdown.

## Live models and authentication

A new root uses the first model named by `quin --model provider/id`, by `defaultProvider` and `defaultModel` in `$XDG_CONFIG_HOME/shield/pi/settings.json` (default `~/.config/shield/pi/settings.json`), or by the `shield.defaultModel` module option, which the packaged quin carries. Model IDs must be exact.

Pi reads credentials from `auth.json` in the same directory. A ChatGPT login written there by Pi, such as a copy of the harness's `auth.json`, is used for `openai/*` models.

Pi 1.1.0 runs as the published Node CLI. The official CommandCode 0.3.0 extension is bundled, so it does not require an initial npm installation. Its catalog fetch still needs network access. Supply `CMD_API_KEY` or `COMMAND_CODE_API_KEY` to **shield start**, or use a runtime command reference in the dedicated Pi `models.json`. Restart the hub after changing its environment. Do not put a key in a Nix expression, command argument, store file, or log. Existing Pi/harness credentials are not read or copied.

For authenticated acceptance, the operator supplies an exact available CommandCode model and key, starts an isolated hub, opens `quin --model command-code/<model-id>`, sends a short prompt, detaches during streaming, and reopens quin in the same directory. Confirm the same agent ID, continued output, and completed response before shutting down the hub. Record the command, result, and operator in the implementation report. This procedure is not an automatic authentication check.

## Controls

- Enter or keypad Enter sends; Shift+Enter inserts a newline. Inputs during execution become follow-ups.
- Ctrl+C while idle clears the current input. During execution, press twice within one second to interrupt; another operation or settled run disarms confirmation.
- Ctrl+Q detaches from every region. It does not stop Pi or answer dialogs.
- Esc cancels the current observed dialog, or returns to the editor. It never interrupts the entire run.
- Tab/Shift+Tab moves focus. In the timeline, j/k or arrows move, Enter/Space toggles details, h/l collapses/expands, y copies the selected item's source text, Ctrl+F/Ctrl+B scroll a screen, and Ctrl+D/Ctrl+U scroll half a screen. In the editor these chords keep their text-editing meaning.
- The bottom line shows the model, thinking level, Pi's context estimate, and the session's token and cost totals.

MOCK, lifecycle, execution, focus, failures, and interruption confirmation are textual, not color-only. Dialogs are *observed pending* requests: Pi does not announce every extension-side cancellation, nor acknowledge UI replies. The first valid reply is forwarded once; timeout is never extended by reattachment.

## Owned data and limits

- Config/auth: `$XDG_CONFIG_HOME/shield/pi` (default `~/.config/shield/pi`).
- History: `$XDG_STATE_HOME/shield/sessions/<cwd-hash>` (default `~/.local/state/shield/sessions`). Pi session files are the persistent history; hub views are memory-only.
- Socket/lock/log: `$XDG_STATE_HOME/shield`. Managed directories are 0700 and files/socket 0600. The stable lock inode is never replaced. Only refused, owned sockets are recovered after acquiring the lock.
- Mock config, HOME, and sessions use separate `shield/mock/` directories. Mock disables resource discovery, external providers, and built-in tools. `/fixture-tool`, `/fixture-dialog`, and `/fixture-timeout` are harmless fixed fixtures; the isolated bash acceptance fixture is not loaded by quin.
- Records are capped at 64 MiB; each connection allows 64 unresolved requests and 16 MiB live backlog, with snapshot bytes accounted separately. Engine correlation is capped at 4096 requests, with 60-second deadlines. Slow/invalid peers are disconnected, not silently truncated. Unknown prompt acceptance is never automatically resent.

Hub restart starts fresh agents/sessions and leaves old Pi history intact. Drafts, selection, scrolling, and expansion remain local to a UI. Arbitrary session/branch mutation by extensions, autonomous startup execution, unsupported RPCs (including `/new`), and Pi TUI-only widgets are outside this milestone. SIGKILL may leave tool descendants; complete process-tree reclamation is not guaranteed. Linux is not supported or live-verified.

## Checks

`nix build .#checks.aarch64-darwin.shield` owns socket/process compatibility: the actual OTP release lock and direct Node Port child, FakeRPC failures, real Pi/faux restore/dialog/queue/history behavior, and the isolated real bash TERM fixture. One shared trace compares the hub and client view at every revision. `nix build .#checks.aarch64-darwin.quin` builds/typechecks clients and exercises renderer/key/focus behavior. Tests use temporary user/config/state/session directories and no provider key.
