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
(see [Plugins](plugins.md#ground-elevation-for-an-asset-later)). Operators will
call Plugins before Assets can, so this idea waits until Assets can call them.

Open question: how accurate the elevation must be.

## Passive listening

On a mesh radio link, every radio hears the messages the other radios send. A
Fieldlink for such a link could let its Asset keep what it hears as a **local
picture**: the Assets nearby, and the Observations and Tracks being reported.
The local picture costs no air time, because the messages are sent anyway. For
example:

- An Asset told to follow a Track it cannot see listens to another Asset's
  observation reports on that Track and steers itself.
- An Asset follows another Asset by hearing its status and position reports,
  and does not ask Core each time.

An Asset uses whatever it can read. A report it cannot read in full is skipped.

Not every link can do this. A point-to-point link, such as SiK, has nothing to
overhear. An Asset on IP would ask Core instead, and today Core lets an Asset
read only its own entry.

Open questions:

- How a listening Asset checks that a report came from the radio it claims to
  come from.
- Which heard records a Fieldlink passes to its Asset app.
- How an Asset's Reset ZIP records what the Asset heard and acted on.
