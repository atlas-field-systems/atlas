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
