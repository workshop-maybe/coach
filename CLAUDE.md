# Coach

A simple, beautiful little desktop app for building credentials and offering them to your agents. Read `README.md` first: its big ideas are the product brief.

## What the app does

- **Credentials.** A credential has a name and a set of learning targets.
- **Collections.** Badges group into collections, and each collection exports as one Andamio course. Built-in collections such as Cardano Dev Skills are added as a unit and become the user's own copy.
- **Acceptance criteria.** Each credential has assignments that a person or an agent can complete and that the user can review. Tasks, rubrics, notes and replies can hold pictures and local videos, kept as files beside the Markdown.
- **Agent profiles.** Named agent setups the user runs locally: harness, model, effort level, the repo it opens in, and free-form parameters.
- **Prompts and handoffs.** The app writes prompts the user copies into the agent of their choice. A handoff wraps a badge's assignment for a test ("this is a test, do it and I'll review your results"). It is customizable: a default skeleton plus one or more handoffs per badge. Other prompts: "check my acceptance criteria", "review this assignment", "suggest assignments for these learning targets". A refine prompt gives an agent the full context to help refine an assignment.
- **Assessments.** The user records whether an agent met a credential's acceptance criteria, with evidence, or holds the reply to judge later beside other agents' replies. Home shows the badges each agent holds, who holds each badge, and the go-to the user chose among its holders. With Jev Mode on, a second opinion calls each rubric point, learning target and the whole bar, with the user's earlier verdicts on that badge as context.
- **Export.** Markdown and JSON.
- **Beyond your computer.** When no local agent meets a credential, the app shows a quiet path toward finding people who hold it. No upsell screens.

The question the app answers: **which of my agents can actually meet my acceptance criteria for each credential I've defined?**

## Constraints

- **Local only.** No account, no external database, no blockchain, no network calls in the prototype, with one exception: Jev Mode, off by default, calls TypeSafe's API with the user's own key, from Rust only, and only when the user asks for a second opinion, a comparison of replies (Compare with Jev, which sends two replies at a time), a paste cleanup, or which badge a job is like.
- **The app never talks to agents.** It produces text the user copies and pastes.
- **No marketplace in the prototype.**
- **Useful first.** The tool has to be worth using on its own. The link to Andamio is a consequence, never the pitch. No hype, no sales language in the UI.
- **Platforms.** Mac and Linux required, Windows optional. Apple-native and mobile versions come later.
- **Vocabulary.** Keep terms close to Andamio's own (learning targets / SLTs, modules, assignments) so exports map onto Andamio courses later.

## Stack

- **Tauri 2** shell (`src-tauri/`, Rust). Keep the native side small: file read/write, clipboard (including Finder-copied file paths), copying dropped or picked files into the data folder, a confined `media://` scheme that serves videos from the data folder (`src-tauri/src/media.rs`), the window's remembered size and position, and Jev Mode's key store and its one TypeSafe request (`src-tauri/src/jev.rs`).
- **React + TypeScript + Vite** UI (`src/`).
- Identifier `io.andamio.coach`.

## Design

- **World.** The app is drawn in the andamio-coach world from product-video-kit (`worlds/cardano`, with the lesson films' palette). Its four rules are at the top of `src/theme/app-tokens.css`. Where it differs from the Andamio brand guide v1.1 (`landing-page-and-blog/docs/design-system/andamio-brand-guide.md`), the world wins.
- **Light only.** Warm paper, white surfaces for records, ink rules.
- **The cast and the records.** Agents are machines with settings (harness, model and effort on three encoders), named in Inter. Credentials are cartridges with the badge on the label, and a test loads a cartridge into a machine. Results and prompts are square record cards with a header bar, speaking in Fragment Mono. The cast (`src/cast/`) and every key and text field are hand-inked; records stay crisp. The window is a darker board with the paper set into it as a sheet whose edge is drawn twice, the way the machine's case is drawn. Keys and fields take their edge from sketched masks (`src/assets/sketch-*.svg`), and how much ink a key carries sets its rank: the ink block, a plain key, a pale ghost key, a link's drawn underline. Precise business logic in a hand-drawn chassis.
- **Color.** Ink on paper. Data blue lights the value or row a view is about and links, never a fill for a piece. Good green marks a pass. Orange stays in the logo. The view's main action is the ink block (`button.primary`), one per view.
- **Tokens.** `src/theme/tokens.css` and `src/theme/tokens.shared.ts` are synced copies of `landing-page-and-blog/src/ui/system/`. Never edit them except the provenance line. App values go in `src/theme/app-tokens.css`.
- **Geometry.** Square. The one exception is the window's own corners (`--window-radius`): the window is frameless, so they round like a native window's, and they square off while it is maximized or full screen. `src/theme/brand.test.ts` fails on color literals or any other rounded corner in component CSS.
- **Fonts.** Inter and Fragment Mono are bundled from `@fontsource`, never fetched.

### Interaction rules

- **Home is the only room.** Home shows what needs you, your agents, your badges and the three doors (Create an agent, Create a credential, Find an agent for a job). Everything else is a deck in progress or one item open (a badge, an agent, one of a badge's handoffs once two or more have run, one reply, or replies compared two side by side under a strip that names them all, which becomes a grid of Jev's calls once any are saved), and each one returns home. A handoff returns to its badge. A reply returns to the badge or handoff that lists it, with its row lit. A compare returns there too, with its replies still picked. Home groups badges by collection once there are two or more, or a built-in copy. Adding, renaming and deleting a collection are decks opened from Home. No sidebar, no other views.
- **Decks, not forms.** Every flow is a list of beats handed to `src/ui/Deck.tsx`. No screen shows a set of labeled fields to fill and submit. Editing an existing badge or agent opens one part at a time as a one-beat deck.
- **One thing per card.** Each card asks one thing and offers one forward action named for what happens next ("Make the badge", "Copy"). Back is quiet.
- **No eyebrows.** Nothing sits above a heading as a kicker or label.
- **No heading periods.** Headings never end in a period.
- **Minimal copy.** Say only what the step needs. One short line beats two.

## Commands

```bash
npm install
npm run tauri dev     # run the app
npm run build         # type-check and build the UI
npm run tauri build   # build installers
npm run site:dev      # the user guide site, live
npm run site:build    # check, build and index the guide into site/dist
npm run site:preview  # serve the built guide (search works here, not in dev)
npm run site:shots    # render the guide's screenshots from the real app
```

## User guide

The user guide lives in `site/` (Astro, drawn in the app's world). It isn't hosted yet, so it is read in the repo. `site/README.md` says how to add a page or a screenshot and how a host would be set up.

A PR that changes what a user sees or does updates the guide in the same PR: the pages that describe it, and the screenshots of the screens it changed, reshot with `npm run site:shots -- --only <id>`. A full `npm run site:shots` is a deliberate refresh, run on one machine, since another OS or Playwright version renders text slightly differently. `npm test` and `npm run site:build` fail when a page cites a label the app no longer has, a picture is missing or unused, or a link is broken. A label renamed in only one of several places still passes, so check the guide by hand when a label changes.

## Repo

Public GitHub repo `workshop-maybe/coach` (`origin`), on a personal account for now. The private `workshop-maybe/coach-desktop` is the archive of its earlier history, with the plans and PRs from before it went public. Work lands on `main` through branches and PRs. Open product decisions and loose ends are GitHub issues.

Everything for this project lives in this folder: strategy, brainstorms, plans, ideation, learnings and handoff notes, under `docs/` where the Compound Engineering skills write them. `docs/brainstorms/`, `docs/plans/`, `docs/ideation/` and `docs/solutions/` are gitignored: they stay on the working machine and never reach the public repo. Nothing goes to a vault, Proof or another doc tool.

`docs/solutions/`, when present locally, holds documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in a documented area.

`CONCEPTS.md` at the root holds the shared domain vocabulary (badges, agents, testing, Jev Mode, first run). Relevant when orienting or naming things.

After a solved, verified problem, offer once to invoke the `ce-compound` skill at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not offer. Completion, effort, and diff size alone are not enough. Offer at the checkpoint, and write the learning to the local, gitignored `docs/solutions/`.

Write every report, summary, or handoff to the user through the `ce-noslop` skill. This applies when you are the top-level agent writing to the user, not when you are a subagent reporting to its caller. Do not apply it to code, config, verbatim quotes, or text the user asked to post as written.
