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

One agent's verdict on one badge, Met or Not met, recorded by the user with the reply the agent sent back and the handoff text that was copied. A Not met result can also carry the rubric points the user tapped as missed. Results are never overwritten, so an agent can hold several results on the same badge and the same handoff. A re-judge can lay a newer verdict over a result without changing its file.

### Reply

The text an agent sent back for a test, pasted into the app and saved on its result, or its held reply, as it stands in the reply box after any cleanup. Also called the handback.

### Run

A handoff that has at least one result or held reply on a badge. A badge with zero or one run shows its replies on the badge page; with two or more, each run opens as its own item.

### Take

One of an agent's replies within a run, a result or a held reply. The reply list shows each agent's latest take with its older takes below, and any number of takes can be compared, two side by side at a time.

### Held reply

A reply the user saved without a verdict, to judge later, usually beside other agents' replies to the same handoff. It shows in the reply list marked Held and is not a result: it holds no badge until the user judges it Met or Not met, which records an ordinary result. A second opinion can be taken on it in compare after it is held, and the newest one goes into the result when it is judged.

### Go-to

The agent the user chose for a badge, even when several hold it. The user marks a Met result to choose it, and every mark stays in the record; a badge's go-to is the agent of its most recent mark. The go-to stays until the user marks another, flagged when it no longer holds the badge, when the badge's task or rubric changed since its latest result, or when its setup changed.

### Re-judge

A later verdict on a reply that already has one, given from where the reply opens. It is saved as its own file beside the agent's results and laid over the result when the folder loads, so the reply keeps its file, its time and its place, and shows the new verdict everywhere. The earlier verdict stays in the record. A go-to stands only while its reply's verdict is Met.

## Jev Mode

### Jev Mode

The optional setting, off by default, that connects the app to TypeSafe's Jev model with the user's own API key. It is the app's only network connection, and Jev acts only when the user asks.

### Second opinion

Jev's reading of a reply against a badge's rubric and learning targets, given only when the user asks: a call for each rubric point and learning target, and one for the whole bar. The request also carries the openings of a few earlier replies on that badge and the user's notes on them. The user still records the verdict, and the reading is saved with the result. In compare it can also be asked for a held reply, and saved beside it until the reply is judged.

### Call

Jev's answer on one rubric point, one learning target or the whole bar, read from its probability as meets, misses or can't call. A badge starts with fixed cut-offs, and they move to fit the user's own verdicts once the badge has enough judged results; moving them re-reads saved readings without asking Jev again.

### Track record

How often Jev's overall call on a badge matched the user's verdicts, counted over the badge's results that carry a reading from the same Jev model, with can't calls counted apart. It shows once there are enough such results, and only where a verdict exists: never before the user picks one, and never on a held reply.

### Overrule

A result whose verdict went against Jev's overall call: Not met against a meets call, or Met against a misses call. Can't call never counts. Overrules lead the examples a second opinion sends.

### Head-to-head

Jev's comparison of two replies to one handoff, asked from compare: for each rubric point, whether the first covers it better than the second, and the reverse, in one request. A reply covers a point better only when both answers agree beyond the default 30 to 70 band, which never moves to fit verdicts. Jev never names a winner across all replies, and a head-to-head never makes a verdict an overrule.
