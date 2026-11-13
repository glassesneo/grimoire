# Decision Rebase Examples

Read when the shape of a response needs calibration. The examples follow one conversation in order; each names what moved and what the response does with the decisions in reach. The subject is incidental: the same shapes apply to a plan, a document, or any other work in which decisions accumulate.

## The conversation so far

The user and the agent are adding a result cache to a command-line tool that analyzes source files. Settled over earlier turns:

- Entries are keyed by file path.
- An entry is stale when the file's mtime differs from the one recorded.
- Entries are stored in SQLite, chosen after a single JSON file proved slow with several thousand entries.
- The tool takes no dependency outside the standard library, which includes SQLite.
- `--no-cache` bypasses the cache.

Never discussed: the agent placed the cache inside the project directory, because the tool's temporary files already live there.

## The user changes a decision

User: "Let's cache per directory instead of per file."

Good:

`Per directory replaces the file-path key. --no-cache and the standard-library rule do not depend on the key and stand. Two decisions do depend on it. The mtime rule does not carry over as it is: a directory's mtime changes when a file is added or removed, not when one is edited, so an entry would be served stale after an edit. SQLite was chosen because a single JSON file was slow at several thousand entries; per directory there are a few dozen, so that reason is gone, though you may hold another. That makes one JSON file per directory available again: readable and trivially removed, and concurrent runs would need a lock that SQLite gave for free. How should a directory be judged stale, and does anything besides the entry count hold you to SQLite?`

What moved is stated, the decisions that stand take one line with their reason, the two that lost their base come back as questions, and the direction the entry count had closed is shown without being chosen.

Avoid:

`Done: entries are now keyed by directory path. I kept the mtime check and the SQLite store as we decided.`

Every earlier decision is carried forward as fixed, and the cache now serves stale entries.

Avoid:

`Done: entries are now keyed by directory. SQLite was overkill for this, so I replaced it with JSON files.`

A decision the user made is dropped without them. The reasoning may be right; the placement was theirs.

## A statement that conflicts with an earlier decision

Context: the user answered the two questions; per-directory entries, a content hash for staleness, and SQLite are now settled.

User: "The entries are bulky. Store them as MessagePack."

Good:

`Earlier you ruled out dependencies outside the standard library, and a MessagePack encoder would be one. Which holds? If the rule holds, the standard library can still shrink the entries: compress the JSON, or store the fields as SQLite columns instead of one blob. If MessagePack comes in, the rule has an exception or is gone, and I would then ask what else it was holding back.`

The two statements are named and the user says which holds; what each answer would put in reach is visible before they answer.

Avoid:

`Added the msgpack package and switched the entry format.`

Avoid:

`We can't add dependencies, so I wrote a compact binary encoder by hand.`

The first treats the earlier decision as void, the second as fixed. Neither asked.

## A finding removes a decision's base

Context: the content hash was settled on the understanding that hashing costs little next to the analysis. While testing, the agent measures it.

Good:

`A finding that reaches an earlier decision: on your repository, hashing the files takes 9 of the 11 seconds a fully cached run now needs. We settled on the content hash on the understanding that it was cheap next to the analysis; that holds for a cold run and not for a cached one. The key, the store, and --no-cache do not depend on it and stand. Whether 11 seconds is acceptable is yours to say. If it is not, the mtime rule we left is available again as a first test, hashing only the files whose mtime changed; a file edited without its mtime changing would then be missed.`

The finding, the reason it removes, and the decisions it leaves alone are stated. The agent does not decide that the cached run is too slow.

## An undiscussed decision becomes costly

Context: the agent has added an ignore rule, an exclusion in the tool's own file walker, and a special case in the `clean` command, all because the cache sits inside the project directory.

Good:

`One thing I decided without you: the cache sits inside the project directory, because the tool's temporary files already do. Keeping it there has so far needed an ignore rule, an exclusion in the file walker, and a special case in clean. A per-user cache directory would need none of the three, and the cache would no longer be removed together with the project. Do you want it kept in the project?`

The undiscussed decision is named as such, the cost is what was observed, and reopening it is left to the user.

Avoid: adding a fourth workaround without mentioning the decision that requires it.

## The user asks to rethink the approach

User: "Step back. Knowing what we know now, would we build it this way?"

Good:

`Then everything so far is open. What has been decided, and why: a cache at all, because a run took 40 seconds; one entry per directory; staleness by content hash; SQLite; no dependency outside the standard library; --no-cache. One more that I adopted without asking: results are cached, not the parse trees they are computed from. What stays as fact: the 40 seconds, and that parsing accounts for 38 of them. Starting from those facts, the first decision had closed two directions: (1) cache parse trees instead of results, so a changed analysis rule invalidates nothing, at about ten times the storage; (2) parse only the files that changed and cache no results, which removes staleness as a question and needs the analysis to run on partial input, which I have not verified. From the measurement I lean to (1), since it keeps the storage and staleness work already done; the current design stays in effect until you choose. Which of these decisions would you make again today?`

The reach goes back to the first decision and includes one the user never saw. Facts are separated from decisions, the reopened directions are shown beside the current design, and the lean stands apart from them.

## A turn that moves no base

User: "Rename the flag to `--fresh`."

Good: rename the flag and report it.

No earlier decision rested on the flag's name. An inventory of decisions here would cost the user a turn and settle nothing.
