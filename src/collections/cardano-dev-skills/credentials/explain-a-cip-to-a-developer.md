# Explain a CIP to a developer

## Learning targets

1. I can explain what a CIP standardizes and what it leaves to the implementer.
2. I can state a CIP's status and how it relates to other CIPs.

## Task

A web developer new to Cardano asks what CIP-30 is.

1. Explain CIP-30 in under 300 words. Say what it standardizes, what it leaves to each wallet, its status, and which CIPs it relates to.
2. Write about 10 lines of plain browser JavaScript, with no library, that connects to the wallet the user picked by its key in `window.cardano` and shows which network the wallet is on.

## Rubric

- The explanation says CIP-30 standardizes the API a wallet injects into the page under `window.cardano`, and that each wallet decides how it asks the user to consent.
- It gives CIP-30's status as Active and names CIP-95, the extension for Conway-era governance, as a CIP that builds on it.
- The code awaits `enable()` and handles a rejected promise, which is how a wallet says no (an `APIError`, such as Refused with code -3).
- The code reads `getNetworkId()` and shows 0 as a testnet and 1 as mainnet.
- If the code shows an address, it treats it as hex-encoded bytes. Code that prints a returned address as if it were bech32 fails.
- The explanation stays under 300 words.

Met when every point holds.

## Source

Written for Coach, on a task the cardano-dev-skills `explain-cip` and `connect-wallet` skills cover (github.com/cardano-foundation/cardano-dev-skills, Apache-2.0). The scenarios are new and no text is copied.
