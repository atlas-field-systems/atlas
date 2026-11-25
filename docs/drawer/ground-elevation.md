# Ground elevation at connect

Some Assets know their height above their launch point, but not above sea level.
When an Asset connects to Core while on the ground, it can ask Core for the
ground elevation at its position and use that as its altitude above sea level.
It can then report both heights.

The elevation comes from a Plugin offering the `ground_elevation` action
([Plugins](../../atlas/plugins.md#ground-elevation-for-an-asset-later)). Operators
will call Plugins before Assets can, so this waits until Assets can call them.

Open question: how accurate the elevation must be.

Out of the drawer when: Assets can call Plugins and the accuracy question is answered.
