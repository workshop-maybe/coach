# Andamio Desktop

A simple, beautiful little desktop app for building credentials and offering them to your agents. Read `README.md` first: its big ideas are the product brief.

## What the app does

- **Credentials.** A credential has a name and a set of learning targets.
- **Acceptance criteria.** Each credential has assignments that a person or an agent can complete and that the user can review.
- **Agent profiles.** Named agent setups the user runs locally: harness, model, effort level, the repo it opens in, and free-form parameters.
- **Prompts and handoffs.** The app writes prompts the user copies into the agent of their choice. A handoff wraps a badge's assignment for a test ("this is a test, do it and I'll review your results"). It is customizable: a default skeleton plus one or more handoffs per badge. Other prompts: "check my acceptance criteria", "review this assignment", "suggest assignments for these learning targets". A refine prompt gives an agent the full context to help refine an assignment.
- **Assessments.** The user records whether an agent met a credential's acceptance criteria, with evidence. Home shows the badges each agent holds and who holds each badge.
- **Export.** Markdown and JSON.
- **Beyond your computer.** When no local agent meets a credential, the app shows a quiet path toward finding people who hold it. No upsell screens.

The question the app answers: **which of my agents can actually meet my acceptance criteria for each credential I've defined?**

## Constraints

- **Local only.** No account, no external database, no blockchain, no network calls in the prototype, with one exception: Jev Mode, off by default, calls TypeSafe's API with the user's own key, from Rust only, and only when the user asks for a second opinion or a paste cleanup.
- **The app never talks to agents.** It produces text the user copies and pastes.
- **No marketplace in the prototype.**
- **Useful first.** The tool has to be worth using on its own. The link to Andamio is a consequence, never the pitch. No hype, no sales language in the UI.
- **Platforms.** Mac and Linux required, Windows optional. Apple-native and mobile versions come later.
- **Vocabulary.** Keep terms close to Andamio's own (learning targets / SLTs, modules, assignments) so exports map onto Andamio courses later.

## Stack

- **Tauri 2** shell (`src-tauri/`, Rust). Keep the native side small: file read/write, clipboard, the window's remembered size and position, and Jev Mode's key store and its one TypeSafe request (`src-tauri/src/jev.rs`).
- **React + TypeScript + Vite** UI (`src/`).
- Identifier `io.andamio.desktop`.

## Design

- **World.** The app is drawn in the andamio-coach world from product-video-kit (`worlds/cardano`, with the lesson films' palette). Its four rules are at the top of `src/theme/app-tokens.css`. Where it differs from the Andamio brand guide v1.1 (`landing-page-and-blog/docs/design-system/andamio-brand-guide.md`), the world wins.
- **Light only.** Warm paper, white surfaces for records, ink rules.
- **The cast and the records.** Agents are machines with settings (harness, model and effort on three encoders), named in Inter. Credentials are cartridges with the badge on the label, and a test loads a cartridge into a machine. Results and prompts are square record cards with a header bar, speaking in Fragment Mono. The cast (`src/cast/`) is hand-inked. The chrome stays crisp. Precise business logic in a hand-drawn chassis.
- **Color.** Ink on paper. Data blue lights the value or row a view is about and links, never a fill for a piece. Good green marks a pass. Orange stays in the logo. The view's main action is the ink block (`button.primary`), one per view.
- **Tokens.** `src/theme/tokens.css` and `src/theme/tokens.shared.ts` are synced copies of `landing-page-and-blog/src/ui/system/`. Never edit them except the provenance line. App values go in `src/theme/app-tokens.css`.
- **Geometry.** Square. The one exception is the window's own corners (`--window-radius`): the window is frameless, so they round like a native window's, and they square off while it is maximized or full screen. `src/theme/brand.test.ts` fails on color literals or any other rounded corner in component CSS.
- **Fonts.** Inter and Fragment Mono are bundled from `@fontsource`, never fetched.

### Interaction rules

- **Home is the only room.** Home shows what needs you, your agents, your badges and the two doors (Create an agent, Create a credential). Everything else is a deck in progress or one item open (a badge, an agent, one of a badge's handoffs once two or more have run, one reply, or two replies compared), and each one returns home. A handoff returns to its badge. A reply returns to the badge or handoff that lists it, with its row lit. A compare returns there too, with both still picked. No sidebar, no other views.
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
```

## Repo

Private GitHub repo `workshop-maybe/coach-desktop` (`origin`), on a personal account for now. It moves to the team when the prototype is ready to share. Work lands on `main` through branches and PRs. Open product decisions and loose ends are GitHub issues.

Everything for this project lives in this repo: strategy, brainstorms, plans, ideation, learnings and handoff notes, under `docs/` where the Compound Engineering skills write them. Nothing goes to a vault, Proof or another doc tool.

`docs/solutions/` holds documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in a documented area.

After a solved, verified problem, offer once to invoke the `ce-compound` skill at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not offer. Completion, effort, and diff size alone are not enough. Offer at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

Write every report, summary, or handoff to the user through the `ce-noslop` skill. This applies when you are the top-level agent writing to the user, not when you are a subagent reporting to its caller. Do not apply it to code, config, verbatim quotes, or text the user asked to post as written.
