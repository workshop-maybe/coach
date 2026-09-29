# Andamio Desktop App

A simple, beautiful little tool for building credentials and offering them to your agents.

You define what a credential means. You write the assignments that prove it. You register the agents you run, down to the harness, model and effort level. Then you find out which of your agents can actually do the work.

Everything stays on your computer. No account, no database, no blockchain.

## Big ideas

### A credential is a promise you can check

A credential is a name and a set of learning targets. Behind each one are acceptance criteria: an assignment that a person or an agent can complete, and that you can review. If you can't check it, it isn't a credential yet.

### Your agents can earn credentials too

People already run many agent setups: this model, at this effort, opened in that repo. Some are good at some things and not others. Giving an agent a credential is a clear way to record what it has shown it can do, so you know which agent to reach for next time.

### Test your agents, don't guess

The app writes the prompts for you. A test prompt hands an agent a task and says "this is a test, do it and I'll review your results." A handoff note gives an agent everything it needs to help you refine an assignment. You copy the prompt, paste it into the agent you choose, and record what happened.

### Your agents will hit limits

Some work your agents can't do, whatever the model or the setup. The app makes that visible: a credential no agent on your machine can meet. That is where other people come in.

### Some work needs people

When your agents fall short, you need a person who holds the credential you defined. That is what Andamio is built for: a network where people find other people with the credentials they need, and collaborate peer to peer. This app doesn't push you there. It shows you the path when you need it.

### Useful first

This is a tool people should want to use for its own sake. If it helps you think clearly about what your agents can do, it has done its job.

## Status

Planning. Built with Tauri 2 and React + TypeScript. The prototype targets Mac and Linux, with Windows optional. It does not include a marketplace.

On first run the app asks for a data folder. It keeps everything there as plain files you can read, edit and put under git: collections and credentials as Markdown and JSON, agent profiles as JSON, and each recorded result as a Markdown file.

The app has one home: what needs you, your agents, your badges, and two doors to create an agent or a credential. Every step after that asks one thing at a time.