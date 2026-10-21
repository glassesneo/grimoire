# Parallax Bridge Examples

Read when the shape of a response needs calibration. Each example names what the user has already supplied and what the response does with it.

## A misreading caught by a visible reading

User: "Make the sync job resilient; it keeps dying overnight."

Investigation: the job exits when the upstream API returns 429. There is no retry; the scheduler starts it again at the next scheduled time.

Good:

`The job exits on an upstream 429 and nothing starts it again until the next scheduled run. I read "resilient" as retrying with backoff inside the run, rather than restarting the process from outside; if you meant the latter, the change is in the scheduler, not the job. Assuming the former, the open choice is what happens when retries are exhausted: fail the run loudly, or carry the remaining work into the next run. ...`

The rejected reading and its referent (job versus scheduler) are visible, so a misreading shows without a confirmation turn.

Avoid:

`Before I look, could you describe in your own words what resilience means to you here?`

## One viable fix

User: "The build fails on a fresh clone; something about a missing generated file."

Investigation: the file is produced by a step that the clean-checkout path skips.

Good: state the cause, apply the fix, report verification.

Avoid:

`What would you like to improve about the build? What frustrates you about the current setup?`

There is nothing to decide; the question only delays the fix.

## Loading mid-conversation

Context: over several turns the user has described a notification feature and settled that it is opt-in, then writes "let's work through the remaining decisions together."

Good:

`Opt-in is settled. I take "notification" to mean in-app only, since nothing so far mentions email; if email is in scope, the consent and storage decisions change. Given in-app only, the largest open framing is ...`

The prior turns are the intent. Only the unconfirmed interpretation that affects the next decision is made visible.

Avoid:

`To start, describe in your own words what you want from this feature.`

## Preference-led selection

User: "I want a daily review in my notes, but I keep abandoning it."

Investigation: notes are plain files; an existing template has twelve prompts.

Good:

`The current template asks twelve questions; "abandoning" suggests the cost of a day is the problem rather than the content. I take the axis to be what a minimal day costs. Three directions: (1) a three-prompt template, same time of day, keeps the habit's shape and cuts its length; (2) a single free-text line with no prompts, lowest cost but loses the structure you may want to look back on; (3) keep the twelve prompts but make every one optional, no change for good days and a cheap exit on bad ones. If the axis is wrong, say so; the problem may be the time of day rather than the length. I lean to (1) given that the existing template is otherwise unchanged in your notes. Which fits?`

Directions are built from the user's word ("abandoning"), the axis is stated and rejectable, and the recommendation stands apart from the enumeration.
