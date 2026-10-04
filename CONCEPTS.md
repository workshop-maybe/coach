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

One agent's verdict on one badge, Met or Not met, recorded by the user with the reply the agent sent back and the handoff text that was copied. Results are never overwritten, so an agent can hold several results on the same badge and the same handoff.

### Reply

The text an agent sent back for a test, pasted into the app and saved on its result as it stands in the reply box after any cleanup. Also called the handback.

### Run

A handoff that has at least one result or held reply on a badge. A badge with zero or one run shows its replies on the badge page; with two or more, each run opens as its own item.

### Take

One of an agent's replies within a run, a result or a held reply. The reply list shows each agent's latest take with its older takes below, and any number of takes can be compared, two side by side at a time.

### Held reply

A reply the user saved without a verdict, to judge later, usually beside other agents' replies to the same handoff. It shows in the reply list marked Held and is not a result: it holds no badge until the user judges it Met or Not met, which records an ordinary result.

### Go-to

The agent the user chose for a badge, even when several hold it. The user marks a Met result to choose it, and every mark stays in the record; a badge's go-to is the agent of its most recent mark. A go-to that no longer holds the badge stays its go-to, flagged, until the user marks another.

## Jev Mode

### Jev Mode

The optional setting, off by default, that connects the app to TypeSafe's Jev model with the user's own API key. It is the app's only network connection, and Jev acts only when the user asks.

### Second opinion

Jev's reading of a reply against a badge's rubric, given only when the user asks: a probability for each rubric point, one overall reading, and a flag on any point it can't call with confidence. The user still records the verdict, and the reading is saved with the result.

### Call

Jev's answer on one rubric point, one learning target or the whole bar, read from its probability as meets, misses or can't call. A badge starts with fixed cut-offs, and they move to fit the user's own verdicts once the badge has enough judged results; moving them re-reads saved readings without asking Jev again.
