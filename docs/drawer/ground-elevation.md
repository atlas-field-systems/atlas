# Terrain and ground elevation

A terrain Plugin, separate from [Fusion](fusion.md), supplies terrain and ground
elevation data. Core, and later Fusion, can use it. An Asset that wants terrain
or ground elevation asks the terrain Plugin, never Fusion.

Some Assets know their height above their launch point, but not above sea level.
When an Asset connects to Core while on the ground, it can call the terrain
Plugin's `ground_elevation` action for its position and use that as its altitude
above sea level. It can then report both heights. Operators will call Plugins
before Assets can, so that use waits until Assets can call Plugins.

Open questions: terrain data sources (such as digital elevation models),
availability offline, and how accurate the elevation must be.

Out of the drawer when: a terrain Plugin is designed and adopted, and for Asset
altitude at connect, Assets can call Plugins and the accuracy question is
answered.
