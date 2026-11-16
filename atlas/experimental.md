# Experimental ideas

These ideas are experimental and not committed.
Nothing here is a requirement until adopted in its owning documentation.

## Ground elevation at connect

Some Assets know their height above their launch point but not above sea level.
When an Asset connects to Core and knows it is on the ground, it can ask Core
for the ground elevation at its position.
Because the Asset is on the ground, that elevation is its altitude above sea level.
The Asset can then report altitude above sea level as well as above its launch point.

The elevation comes from a Plugin that offers the `ground_elevation` action
(see [Plugins](plugins.md#ground-elevation-for-an-asset-later)). Operators will
call Plugins before Assets can, so this idea waits until Assets can call them.

Open question: how accurate the elevation must be.

## Passive listening

Moved into the current [Meshtastic pre-build design](../fieldlink/meshtastic/README.md#listening-and-shared-updates).
