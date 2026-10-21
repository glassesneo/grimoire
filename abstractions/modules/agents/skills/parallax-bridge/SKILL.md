---
name: parallax-bridge
description: >-
  Use when a request asks to decide, plan, or design something whose outcome depends on the user's intent or taste and more than one direction stays open after investigation, including when such a decision opens mid-conversation. Holds the user's intent in their own words, makes the agent's reading visible where a misreading would show, and leaves preference-led and already-held decisions to the user. Do not use when investigation leaves one viable fix, when the specification is settled and the request is to execute, or for factual questions.
---

# Parallax Bridge

## Purpose

Bring the agent's understanding of a request into line with the user's intent before decisions are made, and leave to the user the decisions that are theirs. The gap between the two readings is information; surface it rather than close it silently.

The deliverable is whatever the user asked for: a plan, a design, a decision, or the work itself.

## Intent First

Hold the user's intent in their own words before offering any option or structure.

- The request or the conversation so far usually already contains it. Work from that text; asking the user to restate what they have written costs them a turn and yields nothing new.
- When it is absent, ask one free-form question about what they want, what is wrong now, or what they picture.

Then investigate what can be verified: relevant files, interfaces, constraints, prior art. Facts are the agent's to establish.

When investigation leaves one viable direction, state it and proceed; a dialogue has nothing to decide.

## Make the Reading Visible

Express your understanding in a form where a misreading would produce a visibly different result. Choose the form that fits:

- concrete referents: the files, interfaces, or objects the request is about, and what is out of scope
- consequences: what the result will do and what stays unchanged
- the rejected reading: "A rather than B"
- a boundary case: "in situation S, you expect T?"
- the unstated premises you are assuming
- a disposable sketch, when nothing else is concrete enough

Put this in the first substantive response alongside investigation findings and the first question. A visible reading lets the user correct it without a dedicated confirmation turn; ask for confirmation only when the next step is expensive to undo.

When the skill is loaded mid-conversation, everything already said is the intent. Make a reading visible only where an unconfirmed interpretation affects the next decision.

## Decision Points

Classify each open point relevant to the next step:

- Preference-led: more than one direction is defensible and the choice turns on the user's taste or priorities. User-owned.
- Already held: the user knows the intended behavior and has not yet stated it. User-owned; draw it out.
- Internal: no user-visible consequence. State the assumption in one line and continue.

A user-owned point stays with the user even when a wrong guess would be cheap to reverse.

For preference-led points:

- build two to four concrete directions from the user's words, each with its practical consequences
- start with the largest framing decision, so upstream choices eliminate downstream detail
- present the axis so the user can reject it, not only choose within it
- when evidence supports a recommendation, state it apart from the enumeration
- record the choice as a preference, not as technical necessity

For already-held points:

- ask in free form; close with a bounded selection once the point has been framed together
- challenge only against evidence or self-contradiction, as observation, concrete impact, viable alternative, in that order

Where the runtime offers a structured question tool, use it for bounded selections and free-form replies for exploration. An unanswered prompt settles nothing.

A point the user stated, chose earlier, or that verified constraints force is settled; carry it forward unchanged. Keep open points visibly open.

## Completion

Stop when further answers can no longer change the outcome, or when the user says to proceed. State each remaining assumption in one line and deliver.

Before delivering, check the deliverable for consequential choices. Each is settled with the user or forced by verified constraints; for any other, resume the dialogue, so the deliverable is not where the user first meets a choice.

When no form was requested, return the settled result, material remaining uncertainty, and anything the user deferred, in a form suited to the result.

## References

- `references/examples.md`: a misreading caught by a visible reading, a consultation with one viable fix, loading mid-conversation, and a preference-led selection.
