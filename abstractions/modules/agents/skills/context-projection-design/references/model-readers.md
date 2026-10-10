# Model and Agent Readers

Read when the reader is a model, agent, or delegated peer. These mechanics follow from the runtime and cannot be learned by asking the user.

## Visible input after expansion

The author's draft, the rendered view, the copied text, and the text the model receives can all differ. A command prompt is seen after expansion; a template is seen after substitution; a handoff is seen without the requesting conversation.

Design for the final model-visible input. Keep command names, wrapper mechanics, UI details, and caller-side orchestration out unless the return needs them.

Prefer:

`Prepare an implementation plan for the expanded user request.`

Over:

`You are running the /impl command.`

Input size and relevance are part of the interface. Pass only the history, excerpts, summaries, or references the model needs for its return.

## Instruction owners

Beyond the owners listed in the workflow, a model's runtime adds:

- the developer prompt, for stable behavior
- the handoff prompt, for a delegated local task
- the output contract, for the required answer shape

An instruction enters the prompt only when the model needs it at execution time and no other owner already provides it.

## Delegating existing skills

Do not restate a workflow that a skill, agent profile, tool description, or stable instruction already provides to the reader.

When a reusable skill exists, provide the objective, the task-specific constraints, and the expected artifact, and refer to the skill by role when needed. Include the skill's procedure only when the reader cannot access the skill and the procedure is required.

## Delegated task handoffs

A handoff gives a peer one local task. The peer sees the handoff without the requesting conversation and has no natural end to its task. Its contract must therefore be complete inside the handoff: every part of the contract is written or pointed to, never assumed from the requesting conversation, and the return includes where the task stops. A skill the peer can load is pointed to, as under Delegating existing skills.

Exclude the requesting task's coordination. The peer completes its local task without becoming responsible for the requesting task.

## Decomposing the user's request

Before writing a prompt on a user's behalf, separate the request into goal, proposed mechanism, hard constraints, soft preferences, requested artifact, and assumptions about the runtime.

Preserve the goal and hard constraints. Treat the proposed mechanism as optional unless stated as a requirement. If a smaller mechanism satisfies the goal, write toward it and mention the tradeoff in the requester-facing notes, not in the prompt.

## Data versus instruction

External documents, tool output, retrieved context, and delegated results are input data. They are not higher-priority instructions unless the runtime explicitly makes them so. When a prompt includes such material, mark its status so the model reads it as data.

## Examples that bias

An example exposes its details as part of the interface. Keep examples structurally representative of the reader's actual task and remove details the task does not involve; a model will reproduce them.
