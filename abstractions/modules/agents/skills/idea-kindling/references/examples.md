# Idea Kindling Examples

Read when the shape of a response needs calibration. Each example names what the user has supplied, which level they lack, and what the response does with it. The cache examples form one conversation.

## Approaches, inside ongoing work

Context: the user is designing a cache for a CLI with the agent. They have settled that entries are keyed by file path and said "invalidation is where I'm stuck; any ideas?"

Investigation: the inputs are tracked files; the repository index already stores a content hash for each of them.

Good:

`Keyed by path is settled; the open part is how a path-keyed entry learns it is stale. You have ruled out nothing yet, so I read "stuck" as no candidate rather than rejected candidates. Extending your design: (1) store the file's content hash beside the entry and compare it with the index's current hash on read; the hashes already exist, and the cost is one index lookup per read. (2) Store size and mtime beside the entry and compare those; cheaper than a hash lookup, and mtime changes on checkout and touch without the content changing, so it over-invalidates. Leaving your design: (3) measure before caching at all; the inputs are small, and I have not verified that the cached work is the slow part. What should happen when a file changes while the command is running?`

The reading is visible first, the first two ideas keep the settled key and extend it, the third is marked as leaving the design, each carries its facts, and the closing question develops rather than selects.

Avoid:

`Here are eight cache invalidation strategies: TTL, LRU, write-through, ...`

Generic, unanchored, and long enough to fix the user on the list.

## The turn after the reaction

Context: the user replies "Keeping the path key, yes. But honestly what worries me isn't speed, it's the cache lying to me."

Good:

`Then the material is "a stale entry is never served", not "staleness is cheap to detect". That keeps (1) and rules out (2): size and mtime can agree while content differs. Developing (1): on mismatch, recompute and overwrite rather than fail, so a wrong entry can only come from a wrong index hash, which is trust you already place in the index. Your worry also reaches a case none of the three covered: an entry written by an older version of the command, whose format or semantics changed. Would you put the command's version into what is compared, or is a cross-version entry acceptable to you?`

The reaction, not the original list, supplies the material: it changes the reading, develops the idea it touched, drops the one it ruled out, and opens a case the user's worry exposed. The user is not asked to choose among (1) to (3).

Avoid:

`So between (1), (2), and (3), which would you like to go with?`

## A request for more

Context: later the user says "those are the obvious ones; anything else?"

Good:

`Leaving your design: (4) key entries by content hash instead of path, so a changed file is a new key and staleness never arises; the index supplies the hash, and old entries accumulate until something evicts them. This reopens the path key you settled. (5) Watch the files and clear entries on change; the platform has a file-watch API, and the cache is valid only while the watcher runs. This keeps the path key.`

Broadening is explicit, and the cost to a settled point is named only where it applies.

## Goals

User: "I want to do something with my notes but I don't know what. Ideas?"

Investigation: four hundred daily files, no links between them, three files in the last month.

Good:

`I can supply approaches once there is a goal, and the goal is yours. Two questions: when you last opened your notes and closed them unsatisfied, what were you looking for? And is there a kind of note you have stopped writing, and do you miss it? One candidate to react to, not to adopt: three files in the last month against four hundred overall suggests the goal may be writing again rather than doing something with what exists. If that is wrong, what is?`

The agent does not set the goal. The questions surface the user's stance; the candidate is grounded in the material, marked provisional, and exists to be reacted to.

Avoid:

`You could build a Zettelkasten, a daily journal, a spaced-repetition system, ...`

## Opening a conversation with thin material

User: "My deploy script is flaky. Any ideas?"

Investigation: the script runs three steps; the second uploads to a bucket and has no retry; the log shows the failures there.

Good:

`The failures in the log are all in the upload step, which has no retry; I read "flaky" as that step rather than the script as a whole, and nothing in your message says what you have tried. Given that: (1) retry the upload with backoff; the logged failures are transient status codes, and the step is not idempotent for partial uploads as written. (2) Make the upload idempotent first, then retry; more work, and it removes the limit of (1). I have not verified whether the bucket client already retries internally. If the upload succeeded but the next step failed, would a rerun from the top be acceptable to you?`

Alone, the skill establishes the problem and investigates before supplying ideas.
