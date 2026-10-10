# Context Projection Examples

Read when you need a concrete good/bad pattern for a specific reader type. Each example names the reader and the return first; the text follows from them.

## Expanded command prompt

Reader: a model that sees only the post-expansion task, never the command.
Return: an implementation plan.

Good:

`Prepare an implementation plan for the expanded user request. Use available project context and relevant skills. Prefer the smallest behavior-correct change. Return affected areas, implementation steps, risks, and verification commands.`

Avoid:

`You are running the /impl command. Do not mention slash commands. Do not repeat the implementation workflow.`

The avoided form exposes the command, which the reader cannot see, and forbids concepts the reader never needed.

## Delegated peer task handoff

Reader: a peer responsible for one local task.
Return: a review report, then stop.

Good:

`Inspect the authentication module for authorization boundary risks introduced by the diff between main and feature/session-tokens. Use read-only analysis. Return concrete findings with file references, severity, and recommended fixes. If the scope of the change is unclear, review what you can identify and list what you could not. Stop after the review report.`

Avoid:

`Implement the whole requesting task. Infer the coordination context and decide what every peer should do next.`

## Agent profile or AGENTS.md instruction

Reader: a model loading stable, always-on behavior.
Return: correct behavior on every future task.

Good:

`When editing modules, stage new files before building; flakes only read git-tracked files.`

Avoid:

`For this PR, please remember to git add the new file you just created.`

The avoided form is a local fix placed in an always-on document.

## Reviewer prompt

Reader: a model producing structured findings.
Return: findings a human can act on.

Good:

`Review the diff for behavior-preserving correctness. Return findings as severity, evidence (file:line), impact, and smallest safe fix. Report only issues with concrete impact.`

Avoid:

`Carefully review everything and tell me if anything looks off.`

## README for a new user of a tool

Reader: a person who has not used the tool and holds general command-line knowledge.
Return: a first successful run.

Good:

First layer: what the tool does in one sentence, the install command, the first command to run, and where to look when it fails. On demand: a link to the full option reference.

Avoid:

Opening with the architecture, the history of the design, or the module layout. These expose implementation the reader will start to depend on and cannot act on for the return.

## Pull request description

Reader: a reviewer who must approve or request changes, and sees the diff.
Return: an approval decision.

Good:

What changed at the level of behavior, why, what the reviewer should look at closely, and how it was verified. Rationale is in the projection because the return is a judgment.

Avoid:

Restating the diff line by line (already held by the reader), or the author's intermediate attempts (process, not result).

## Handover note to a named colleague

Reader: one person with known context, taking over a task.
Return: continuing the task without re-deriving its state.

Good:

Current state, the next concrete step, the open decisions marked as open, and where each artifact lives. Omit what that person already knows.

Avoid:

A full history of the task, or open questions written as if settled.

## Review output

Reader: the requester, unless they ask for only the revised text.
Return: a decision on whether to accept the revision.

Good:

`Issue: The prompt assumes the reader can see command mechanics. Revision: Replace command references with the post-expansion task objective. Rationale: The model receives the expanded task, not the command, so the references name something it cannot act on.`

Avoid:

`This is a bad prompt. Do not do many things.`
