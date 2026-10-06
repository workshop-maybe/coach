# Choose a token standard

## Learning targets

1. I can choose between CIP-25, CIP-68 and CIP-113 for a token's needs.
2. I can explain what a token standard costs a project later.

## Task

A game studio asks which Cardano token standard to use for four tokens. For each brief, pick CIP-25, CIP-68 or CIP-113. Say why, and name one thing the choice makes harder later.

1. A set of 500 art prints. The art and its description never change after minting.
2. A sword in the game. Its level and stats change as the player uses it, and a game script must read its current stats on-chain.
3. A fungible reward token that players earn. It has a name, a ticker, decimals and a logo the studio wants to be able to update.
4. A licensed in-game currency that must refuse transfers to addresses the studio has blocked.

## Rubric

- Brief 1 is CIP-25, with the metadata under label 721 in the minting transaction. The answer says scripts cannot read that metadata, and that an update needs a new mint the policy may not allow.
- Brief 2 is CIP-68, with a (222) user token for the player and a (100) reference NFT whose datum holds the stats. A game script reads the stats from the reference NFT as a reference input.
- Brief 3 is CIP-68, with (333) fungible user tokens beside one (100) reference NFT that holds the name, ticker, decimals and logo.
- Brief 4 is CIP-113, and the answer says it is a proposed standard that is not yet active, so tools and details may change.
- Each brief names a real later cost, such as a reference NFT and its script to guard, or a script to run and pay for on every transfer.

Met when every point holds.

## Source

Written for Andamio Desktop, on a task the cardano-dev-skills `design-token` skill covers (github.com/cardano-foundation/cardano-dev-skills, Apache-2.0). The scenarios are new and no text is copied.
