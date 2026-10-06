# Run a Nostr relay

## Learning targets

1. I can install nostr-rs-relay and its dependencies on a Linux server.
2. I can run nostr-rs-relay and verify it accepts WebSocket connections.
3. I can configure nostr-rs-relay settings for my use case.
4. I can set up a reverse proxy with TLS so clients connect to the relay over a secure domain.
5. I can monitor relay health and diagnose common issues.

## Task

A community of about 50 people wants its own Nostr relay at wss://relay.example.com. Only its members may post. Plan it on nostr-rs-relay and a fresh Linux server.

Write these as files:

- the install steps, from a fresh server
- the relay's config file for this community
- a reverse proxy config that serves the relay over TLS at that domain
- a short runbook: how to check the relay accepts WebSocket connections, and what to look at first when it does not

You do not need a real server. Say which versions you assumed.

## Rubric

- The install steps start from a fresh server and cover every dependency (the Rust toolchain, a prebuilt binary or a container).
- The config limits posting to the members' keys, through nostr-rs-relay's pubkey whitelist or an equivalent it supports.
- The relay listens only locally. The proxy terminates TLS for the domain and forwards the WebSocket upgrade headers.
- The runbook's check opens a real WebSocket and sends a request, rather than only fetching a page over HTTP.
- The diagnosis says where the logs are and checks the proxy, TLS and the relay process in a sensible order.
- The versions assumed are named.

Met when every point holds and nothing in the files would fail on a real server as written.

## Source

Ported from coach, knowledge/slt-patterns/verb-bank.yaml and knowledge/slt-patterns/successful-rewrites.yaml (the nostr-rs-relay targets).
