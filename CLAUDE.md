# Andamio Desktop

A simple, beautiful little desktop app for building credentials and offering them to your agents. Read `README.md` first: its big ideas are the product brief.

## What the app does

- **Credentials.** A credential has a name and a set of learning targets.
- **Acceptance criteria.** Each credential has assignments that a person or an agent can complete and that the user can review.
- **Agent profiles.** Named agent setups the user runs locally: harness, model, effort level, the repo it opens in, and free-form parameters.
- **Prompts and handoff notes.** The app writes prompts the user copies into the agent of their choice: test prompts ("this is a test, do it and I'll review your results"), "check my acceptance criteria", "review this assignment", "suggest assignments for these learning targets". Handoff notes give an agent the full context to help refine an assignment.
- **Assessments.** The user records whether an agent met a credential's acceptance criteria, with evidence, and sees an agent × credential matrix.
- **Export.** Markdown and JSON.
- **Beyond your computer.** When no local agent meets a credential, the app shows a quiet path toward finding people who hold it. No upsell screens.

The question the app answers: **which of my agents can actually meet my acceptance criteria for each credential I've defined?**

## Constraints

- **Local only.** No account, no external database, no blockchain, no network calls in the prototype.
- **The app never talks to agents.** It produces text the user copies and pastes.
- **No marketplace in the prototype.**
- **Useful first.** The tool has to be worth using on its own. The link to Andamio is a consequence, never the pitch. No hype, no sales language in the UI.
- **Platforms.** Mac and Linux required, Windows optional. Apple-native and mobile versions come later.
- **Vocabulary.** Keep terms close to Andamio's own (learning targets / SLTs, modules, assignments) so exports map onto Andamio courses later.

## Stack

- **Tauri 2** shell (`src-tauri/`, Rust). Keep the native side small: file read/write and clipboard.
- **React + TypeScript + Vite** UI (`src/`).
- Identifier `io.andamio.desktop`.

## Design

- **Canon.** The Andamio brand guide v1.1 in `landing-page-and-blog/docs/design-system/andamio-brand-guide.md`. That repo is read-only from here.
- **Tokens.** `src/theme/tokens.css` and `src/theme/tokens.shared.ts` are synced copies. Never edit them except the provenance line. To resync, copy both from `landing-page-and-blog/src/ui/system/` and update that line. App tokens go in `src/theme/app-tokens.css`.
- **Accents.** One orange (`button.primary`) per view. Blue for links and the active nav item only, never a fill. Feedback uses the state palette.
- **Geometry.** Square. `src/theme/brand.test.ts` fails on color literals or rounded corners in component CSS.
- **Fonts.** Inter and JetBrains Mono are bundled from `@fontsource-variable`, never fetched.

## Commands

```bash
npm install
npm run tauri dev     # run the app
npm run build         # type-check and build the UI
npm run tauri build   # build installers
```

## Repo

Local only, no remote yet. It gets a remote when the prototype is ready to share with the team.
