# Plugins

A Plugin is a small program that runs inside Core and offers actions. An
operator runs an action with inputs, such as an area or a building. The Plugin
gathers information with the tools it has, often open-source services, and
returns what it found.

This page records the owner's intended use. No Plugin exists yet.

## Where Plugins sit

- Plugins run in Core's Plugins module. How a Plugin works with the rest of
  Core, such as reading Entities or storing Objects, is Core's own business.
  Protocol does not carry it, just as it does not carry traffic between
  Entities and Tasks.
- Protocol carries one thing for Plugins: a call to an action and its result.
  That is how an operator interface uses a Plugin from outside Core.
- Operators call Plugins today. Assets will be able to call them later.
- Plugins do not direct Assets or issue Tasks.
- Fusion is not a Plugin. Core runs it on every Observation, and nobody calls it.
- A feed that sends data all the time, such as an internet aircraft feed, is an
  Asset, not a Plugin.

## Actions

Each Plugin lists its actions, and each action takes its own inputs. An action
returns one of two kinds of output:

- **A list.** The output is the list itself, returned to the caller.
- **A reference.** The Plugin creates something in Core, such as an Object, a
  Track, a geo feature or another Entity, and the output names it. The result
  stays in Core, where the operator can find it later.

## Examples

### Find the buildings in an area

The operator passes a box and asks for every building in it. The Plugin asks
the Overpass API (OpenStreetMap data) for the structures in that box and
returns them as a list.

### Analyze a building

The operator picks a building and asks the Plugin to analyze it. The Plugin
runs whatever open-source tools it has. It creates a geo feature on the
building and puts its findings in the geo feature or in an Object attached to
it. The output is a reference to that geo feature.

### Gather imagery for an intelligence package

The operator passes an area and asks for satellite imagery of it. The Plugin
collects what imagery its tools can reach and stores it in Core, for example
as Objects. The output refers to what it stored.

### Ground elevation for an Asset (later)

An Asset sends its position and asks for the ground elevation there. With it,
the Asset can work out its height above the ground, whether it uses a
barometer or the altitude of the place it took off from.

## Not decided

How the operator application shows Plugins and their results is not decided.
How Plugins run inside Core, such as how one is installed and started, waits
until Core's architecture is clearer.
The exact call and result messages are open in
[Protocol open questions](https://github.com/atlas-field-systems/protocol/blob/main/docs/open-questions.md#plugins).
