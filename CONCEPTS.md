# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Badges and agents

### Badge

A credential as the app shows it: a name, learning targets, a task and a rubric, drawn as a cartridge with the badge on its label. "Credential" is the same thing in data and exports.

### Agent

A named setup the user runs outside the app: harness, model, effort, and the repo and parameters it works with. Its setup locks once it has a result, so every result stays tied to the setup that produced it.

## Testing an agent

### Handoff

The prompt that hands a badge's task to an agent for a test. It is a template filled from the badge each time it is copied, so it always carries the badge's current name, learning targets and task, and never its rubric. A badge can have several handoffs; once any result names one, it is locked and editing it saves a new one.

### Skeleton

The default handoff every badge starts from, shown as key S. It never locks, so results that ran it may have run different versions of its text. A result recorded before handoffs existed counts as having run the skeleton.

### Result

One agent's verdict on one badge, Met or Not met, recorded by the user with the reply the agent sent back and the handoff text that was copied. A Not met result can also carry the rubric points the user tapped as missed. Results are never overwritten, so an agent can hold several results on the same badge and the same handoff.

### Reply

The text an agent sent back for a test, pasted into the app and saved on its result, or its held reply, as it stands in the reply box after any cleanup. Also called the handback.

### Run

A handoff that has at least one result or held reply on a badge. A badge with zero or one run shows its replies on the badge page; with two or more, each run opens as its own item.

### Take

One of an agent's replies within a run, a result or a held reply. The reply list shows each agent's latest take with its older takes below, and any number of takes can be compared, two side by side at a time.

### Held reply

A reply the user saved without a verdict, to judge later, usually beside other agents' replies to the same handoff. It shows in the reply list marked Held and is not a result: it holds no badge until the user judges it Met or Not met, which records an ordinary result.

### Go-to

The agent the user chose for a badge, even when several hold it. The user marks a Met result to choose it, and every mark stays in the record; a badge's go-to is the agent of its most recent mark. The go-to stays until the user marks another, flagged when it no longer holds the badge, when the badge's task or rubric changed since its latest result, or when its setup changed.

## Jev Mode

### Jev Mode

The optional setting, off by default, that connects the app to TypeSafe's Jev model with the user's own API key. It is the app's only network connection, and Jev acts only when the user asks.

### Second opinion

Jev's reading of a reply against a badge's rubric and learning targets, given only when the user asks: a call for each rubric point and learning target, and one for the whole bar. The request also carries the openings of a few earlier replies on that badge and the user's notes on them. The user still records the verdict, and the reading is saved with the result.

### Call

Jev's answer on one rubric point, one learning target or the whole bar, read from its probability as meets, misses or can't call. A badge starts with fixed cut-offs, and they move to fit the user's own verdicts once the badge has enough judged results; moving them re-reads saved readings without asking Jev again.

### Track record

How often Jev's overall call on a badge matched the user's verdicts, counted over the badge's results that carry a reading from the same Jev model, with can't calls counted apart. It shows once there are enough such results, and only where a verdict exists: never before the user picks one, and never on a held reply.

### Overrule

A result whose verdict went against Jev's overall call: Not met against a meets call, or Met against a misses call. Can't call never counts. Overrules lead the examples a second opinion sends.

### Routing ask

Jev's answer, only when the user asks, to which badge a new job is like and how hard the job is: one yes-or-no question per badge, sent with the badge's name, task and learning targets and never its rubric, and one rating of the job as routine, needing judgment, or unusual or high-stakes.

## Finding an agent

### Holds cleanly

An agent holds a badge cleanly when its latest result there is Met with no "task changed" or "setup changed" flag. Home counts a flagged Met as holding; the router counts only a clean one.

### Cost order

The order the user sets over their agents, cheapest first, from Home's agent list. The router picks the cheapest agent that holds a badge cleanly by it, and steps up through it for a job rated unusual or high-stakes. An agent it doesn't name counts as most expensive until the user places it.

### Routing record

What the app keeps each time the user takes an agent for a job: the job's first line, the badge, the agent taken and its setup, the agent the card picked and why, and how the badge was found. One file per decision, written once, so a past choice can later count as a decision reused.
