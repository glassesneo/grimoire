---
name: context-projection-design
description: >-
  Use when deciding what part of the author's context a document exposes to its reader, and in what order, before or while writing or reviewing it. The reader may be a model or agent (command prompts, AGENTS.md and agent instruction files, delegated task handoffs, reusable prompt templates) or a human or persona (README and reference documentation, PR descriptions, reports, handover notes, messages to a named role). Trigger when the reader differs from the author, when one set of facts must reach several readers, or when a text is reviewed for leaked internals, missing preconditions, or an unclear expected action. Do not use for prose style, rhythm, or language-specific writing rules, for user-interface design, or for prompt-injection security analysis.
---

# Context Projection Design

## Purpose

Design the projection of the author's context onto each reader.

A document is an interface between its author and its reader. What it exposes is a projection: the part of what the author holds that a given reader needs for a given return, in the order the reader needs it. This skill derives the projection, and where each part of it belongs, from the reader's contract rather than from what the author knows.

The skill holds the derivation, not a catalogue of what particular readers need. Who the reader is and what they hold is established each time: inferred from the runtime when the reader is a model, obtained from the user when the reader is a human and the answer would change the projection.

## Use This Skill For

- writing a text whose reader is not its author
- choosing between one document and several when readers differ
- deciding which document, layer, or system an instruction or fact belongs to
- reviewing a text for leaked internals, missing preconditions, or an unclear expected action
- separating a usable artifact from the notes that explain it

## Do Not Use This Skill For

- sentence-level style, rhythm, or language-specific writing rules; apply those after the projection is decided
- designing user interfaces
- prompt-injection or security analysis beyond the data-versus-instruction status defined below

## Core Model

Four terms carry the skill. Keep them distinct.

- Context: everything the author holds that could enter the document: concepts, facts, instructions, permissions, decisions, and their status. When reviewing someone else's text, it is what that author held, as far as the text, its sources, and the requester show it.
- Contract: the definition of the reader that the projection serves. It has five parts, listed under Define the Contract.
- Projection: the smallest closure of the author's context that takes the reader from what they already hold to the return the contract requires. Closure means that each included item brings what it presupposes. Different readers of the same context receive different projections.
- Layer: the position at which part of the projection is exposed: on first read, on demand, or in another document.

Context that a text exposes, but that is neither in the projection nor already held by the reader, is a leak: it costs attention and, as below, creates dependence, whether or not the reader can act on it.

Two consequences follow.

Exposure has a cost beyond attention, because a document is an interface: its reader depends on whatever it exposes, and what is depended on becomes hard to change. Implementation detail in a README fixes the implementation, because readers come to rely on it; wrapper mechanics in a prompt couple the prompt to the wrapper; an author's process in a report invites review of the process instead of the result. The cost is a reason to leave out what the return does not need, never what it does.

What is exposed carries a status. For a model, retrieved documents, tool output, and delegated results are data, not instructions, unless the runtime makes them so. For a human, a settled decision and an open question are different things. Presenting one as the other is a contract violation even when the content is accurate.

## Define the Contract

Before writing, state the five parts.

- Reader: who or what consumes the text; one or several.
- Visible input: what the reader actually sees. If a system renders, expands, copies, routes, or truncates the text first, design for the final reader-visible form, not the author's draft.
- Resources: what the reader already holds or can reach: knowledge, skills, tools, files, time, authority, and their limits.
- Return: what the reader must decide, do, or produce after reading. For a model this is the output contract; for a human it is the action or decision.
- Insufficiency behavior: what the reader should do when a precondition is missing: proceed on a stated assumption, return a partial result, ask, or stop.

The return is the strongest anchor. Fix it first; the projection is defined relative to it.

## Missing Contract Parts

This section is about the author lacking a part of the contract. The reader's own insufficiency behavior is a contract part and is written into the text.

Where the missing knowledge lives decides whether to infer or ask. Never substitute a generic reader for an unknown one.

- Return: ask; the projection cannot be derived without it.
- A model or agent reader: the author is the same kind of reader. Infer what it sees, which skills and tools it has, and what it may do from the reader's runtime as the author can observe it, not from the author's own; do not ask the user to describe a model. State the inferred visible input when it affects correctness.
- A human or persona reader: the knowledge is the user's. Proceed on an assumption stated with the artifact, unless different answers would change the projection or the return materially; then ask.
- Rendering, expansion, or a runtime that cannot be inferred, such as a receiver in another environment: design for the most restrictive plausible form and say so.

## Workflow

1. Name the reader or readers.
2. Fix the return for each reader.
3. Describe visible input and resources after any rendering or expansion, and decide the insufficiency behavior.
4. List the author's context relevant to the text and decide each item in order:
   - the return does not need it: leave it out; exposing it would be a leak
   - the reader already holds it: leave it out
   - the reader can reach it at the moment it is needed: point to it
   - otherwise: include it with what it presupposes

   The included items and pointers are the projection.
5. Order the projection into layers: what the reader needs on first read, what is needed on demand, what belongs in another document.
6. Place each item where it belongs. Common owners: stable behavior in a system prompt, agent profile, or policy document; reusable procedure in a skill; project facts in project documentation or memory; the current request in the task prompt; routing and expansion in the system that passes the text on. Write into this document only what the reader needs from this document at read time.
7. For several readers, derive the projection and its layers for each reader before deciding how the readers share documents.
8. Write the smallest text that exposes the projection in that order, then run the checks below.

## Positive Contracts

Constrain a reader by defining the return, not by listing what to avoid.

To prevent an unwanted outcome, use this order:

1. Omit the concept the reader does not need.
2. State the desired outcome.
3. Narrow the required form of the return.
4. Add an explicit prohibition only for a likely and costly failure.

A prohibition exposes the concept it forbids; it enters the projection like anything else.

## Artifact Boundary

Separate the artifact the reader will consume from notes for the requester, who asked for the text and is not its reader unless the two coincide.

Rationale, tradeoffs, and boundary assumptions enter the artifact only when the return requires them: a reader who must judge needs the rationale; a reader who only executes does not. Otherwise they are requester-facing notes and stay outside the artifact unless the user asks to include them.

When a text is reused by future readers, check each rule before adding it: it must hold for every intended reader of that text, and not depend on a format, runtime, or example the text is not written for. A local fix belongs in a local document.

## Output Contract

When asked to write a text, return the artifact itself. Add notes only when the user asks for them, when an assumption about the reader, runtime, or rendering was made, when the user's proposed form should be challenged, or when the artifact depends on another document, skill, or expansion step.

When asked to review a text, return the observed issues against the contract, a revised text, and a short rationale. A review is requester-facing unless the user asks for only the revision.

## Checks

Before finalizing, confirm:

- Every item in the text is needed for the return or points to where it is.
- Nothing the reader already holds is restated.
- No wrapper, command, process, or coordination detail remains that the return does not need.
- The first layer alone lets the reader start the return.
- Status is explicit where it matters: data versus instruction, settled versus open.
- Prohibitions are limited to likely and costly failures.
- Insufficiency behavior is stated when a precondition may be missing.
- Delegated or scoped tasks have a stop condition.

## References

- `references/model-readers.md`: mechanics specific to readers that are models or agents: prompt expansion, instruction owners, delegating existing skills, delegated task handoffs, and request decomposition.
- `references/examples.md`: good and bad patterns per reader type, for both model and human readers.
- `references/review-checklist.md`: review and generalization checks beyond the Checks above.
