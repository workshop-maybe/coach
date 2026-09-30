---
name: Andamio Desktop
last_updated: 2026-09-30
---

# Andamio Desktop Strategy

## Purpose

People who run agents can't tell which model and setup is good enough for which of their tasks. So they either pay for the expensive model everywhere or trust a cheaper one blindly. Public benchmarks don't settle it: the tests aren't the person's own work, and the tests and results often aren't public.

## Positioning

Testing your agents should feel like playing an Elektron box: start from a preset or build your own, tweak the settings and load a credential into an agent. An agent here is the whole setup (model, harness, effort, and the repo, machine and memory it runs with), not a model on a leaderboard. Every test, even a quick preset, runs on a full credential that an agent or a person could hold, so each comparison adds to a record of what your agents can and can't do.

## Users

**Primary:** Daily agent operators - They run several harnesses and models every day and pay for them. They're hiring Andamio Desktop to find out, on tests drawn from their own work, which setup is good enough for each kind of task, so they stop guessing and stop overpaying.

## Boundaries

- No telemetry. Once downloaded, the app only speaks through what people choose to share.
- The standalone box comes first. API keys, and the app running agents itself, are syncing the box to a computer. They come later.
- Sharing credentials and the Andamio issuer API come later. Posting a result as an image is in now.
- The path toward people who hold a credential comes later, alongside sharing and the issuer API.
- The web version comes later, alongside sharing. It's a door to the download with presets only, never a second product.
- Never say "machine" in the app. The Elektron box is how we think about it, not what we call it.
- Badge and box visuals are placeholders. The hand-drawn line stays, and the specific drawings can change.

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

Credential, test prompt, review and recorded result. Each result carries its cost, copied from the harness's own usage report, and the session metadata set in settings. The agent's reply is kept as written. You can mark a result as the agent you'll use for that kind of task.

_Why it serves the approach:_ decisions made and reused depend on results you trust and can compare on cost.

### The agent setup

Capture the whole setup: model, harness, effort, and the context it runs with (repo, machine, memory), including the parts you can't see.

_Why it serves the approach:_ you're choosing between setups, not models, and that's the claim a benchmark can't make.

### Presets

Factory credentials with example learning targets and tests that run the full flow.

_Why it serves the approach:_ people can play quickly without skipping the credential.

## Brand

**One-liner:** Credential your agents.

**Key message:** Your tests, your agents, your record. Assess your agents and keep track of what they can do.
