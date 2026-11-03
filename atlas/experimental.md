# Experimental ideas

These ideas are worth exploring. They are **experimental and not committed**.
Nothing here is a requirement until it moves into another Charter page.

## Ground elevation at connect

Some Assets know their height above home but not above sea level.
When an Asset connects to Core and knows it is on the ground, it can ask Core
for the ground elevation at its position.
Because the Asset is on the ground, that elevation is its altitude above sea level.
From then on, the Asset can report altitude above sea level as well as above home.

Open questions: where Core gets elevation data in the field, and how accurate it must be.

## Links, not just messages

Every Atlas connection is now a two-way stream, like a WebSocket. So a radio's job
is to keep a live link up between radios, not just to deliver single messages
from A to B. This may become its own Charter section later.

Open questions: how a radio link is set up and kept stable, how it reroutes when
the mesh changes, how it copes with Assets moving, and what to call the stream
idea, since it spans WebSocket and radio links.

## Passive listening

On broadcast radio links (FLRC, LoRa; not IP), Assets can listen to traffic that
is already on the air and build a passive picture of the operation without asking
Core. For example:

- An Asset told to follow a Track it cannot see listens to another Asset's
  observation reports on that Track and steers itself.
- An Asset follows another Asset by hearing its status and position reports.

Naming is still open for the always-open connection idea: "session" fits because
the link stays open; "link" feels too generic.
