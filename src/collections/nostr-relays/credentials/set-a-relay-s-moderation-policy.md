# Set a relay's moderation policy

## Learning targets

1. I can define a moderation policy for a relay.

## Task

A community of about 50 people runs its own Nostr relay on nostr-rs-relay. Today anyone can post to it. This week one key posted thousands of spam notes, and someone sent a flood of very large events that is filling the disk.

The members want to keep posting freely. People outside the community should still be able to read the relay.

Write:

- the relay's moderation policy, in a few lines the members could read
- the nostr-rs-relay settings that enforce it, as they would appear in its config file
- what to do about the spam the relay already stores

Say which nostr-rs-relay version you assumed.

## Rubric

- The policy says who may post, what is refused and who decides, in plain words.
- Every setting it names exists in nostr-rs-relay. A setting the relay does not have, such as a per-key blocklist, fails the test.
- Members and outsiders are treated differently. Members' keys go in `pubkey_whitelist`, or an equivalent the relay supports, such as NIP-05 verification against the community's domain or an event admission server. Outsiders can still read.
- Large events are capped with `max_event_bytes`, at a size that fits the notes members post.
- If it sets `messages_per_sec`, it says the limit is for the whole relay, not for one key.
- The spam already stored is removed from the database by author, after a backup. A config change alone leaves it in place and fails.
- The version assumed is named.

Met when every point holds.

## Source

Written for Andamio Desktop, on the moderation target in coach's knowledge/slt-patterns/verb-bank.yaml (github.com/Andamio-Platform/coach, MIT). The scenario is new and no text is copied.
