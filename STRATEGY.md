---
name: Coach
last_updated: 2026-10-06
---

# Coach Strategy

## Purpose

People hand work to agents before deciding what it should accomplish. The output arrives faster than anyone reads it, wrong assumptions go undetected, and slop becomes someone else's work. Without criteria of their own, they can't tell which setup does their work well. Public benchmarks can't tell them either: the tests aren't their work, and even a well-built answer key can be wrong in ways nobody using the score can see.

## Positioning

Coach is hands-on software with no AI inside, the way an Elektron box is hands-on next to a DAW. The one exception is Jev Mode, off unless you turn it on with your own TypeSafe key: it gives a second opinion on a reply, cleans up a terminal copy, and says which badge a new job is like, only when you ask. You define what the work should accomplish before you hand it to an agent, turn the dials on the setup and judge each result yourself. Taking that time gets better results. Every test runs on a full credential that an agent or a person could hold, so the record shows what succeeds at the work that matters to you.

The app is a training coach you outgrow. It gives you the big picture of what your agents can do and helps you build a mental model of your own workflows. Once you know which setup handles a kind of work, the choice becomes habit and you stop checking. You come back when results slip, to change the test and run it again.

## Users

**Primary:** Daily agent operators - They run several harnesses and models every day and pay for them. They're hiring Coach to find out, on tests drawn from their own work, which setup is good enough for each kind of task, so they stop guessing and stop overpaying.

## Boundaries

- No telemetry. Once downloaded, the app only speaks through what people choose to share.
- The standalone box comes first. API keys, and the app running agents itself, are syncing the box to a computer. They come later, with one exception: Jev Mode takes your own TypeSafe key, is off by default, and sends text to TypeSafe only when you ask.
- Sharing credentials and the Andamio issuer API come later. Posting a result as an image is in now.
- The path toward people who hold a credential comes later, alongside sharing and the issuer API.
- The web version comes later, alongside sharing. It's a door to the download with presets only, never a second product.
- Never say "machine" in the app. The Elektron box is how we think about it, not what we call it.
- Badge and box visuals are placeholders. The hand-drawn line stays, and the specific drawings can change.
- Third-party benchmark questions, such as HLE's, never ship inside the app. The user imports them. HLE's authors ask people not to redistribute the questions, and the dataset is gated.
- No shots at named benchmarks. Their errors show why your own judgment matters, not that the benchmark is bad.

_Resist a change when:_ it makes the box depend on anything beyond the user's own machine before the standalone box is delightful.

## Key metrics

- **Decisions made** - you marked a result as the agent you'll use for a task, whether it changed or confirmed your choice; your data folder.
- **Decisions reused** - a past mark settled a new choice without a new test; your data folder.
- **People posting about using it** - posts showing their own results or credentials, not reposts of the launch; social search by hand.
- **Issuer API sign-ups from the app** - people who reach Andamio through the app; Andamio, once the integration exists.

## Tracks

Worked in this order.

### The box feel

Home, decks and the hand-drawn cast: pick an agent, tweak its settings, load a credential, and end with a result worth posting ("post this" as an image card).

_Why it serves the approach:_ the bet is that testing feels like playing an instrument. Without that feel, this is one more eval tool.

### The test loop

Credential, test prompt, review and recorded result. Each result carries its cost, copied from the harness's own usage report, and the session metadata set in settings. The agent's reply keeps the agent's words and their order, with terminal artifacts removed. You can mark a result as the agent you'll use for that kind of task.

_Why it serves the approach:_ decisions made and reused depend on results you trust and can compare on cost.

### The agent setup

Capture the whole setup: model, harness, effort, and the context it runs with (repo, machine, memory), including the parts you can't see.

_Why it serves the approach:_ you're choosing between setups, not models, and that's the claim a benchmark can't make.

### Presets

Factory credentials with example learning targets and tests that run the full flow.

_Why it serves the approach:_ people can play quickly without skipping the credential.

## Brand

**One-liner:** Credential your agents.

**Key message:** Slow down and decide what good looks like. Your tests, your agents, your record. Assess your agents and keep track of what they can do.
