# Experimental ideas

These ideas are experimental and not committed.
Nothing here is a requirement until it moves into another Charter page.

## Ground elevation at connect

Some Assets know their height above their launch point but not above sea level.
When an Asset connects to Core and knows it is on the ground, it can ask Core
for the ground elevation at its position.
Because the Asset is on the ground, that elevation is its altitude above sea level.
The Asset can then report altitude above sea level as well as above its launch point.

The elevation comes from a Plugin that offers the `ground_elevation` action
(see [Plugins](plugins.md#ground-elevation-for-an-asset-later)). Plugins wait
until after first flight. Operators will call them before Assets can, so this
idea waits for Plugins.

Open question: how accurate the elevation must be.

## Passive listening

On broadcast radio links (FLRC, LoRa; not IP), a Fieldlink could let its Asset
hear existing traffic and build a passive picture of the operation without
asking Core. For example:

- An Asset told to follow a Track it cannot see listens to another Asset's
  observation reports on that Track and steers itself.
- An Asset follows another Asset by hearing its status and position reports.

Open question: which heard records a Fieldlink passes to its Asset app.
