# Plugins

This page records the owner's intended use. Plugins are part of the product and
are built with the rest of it. No Plugin exists yet.

A Plugin is a small program that runs beside Core and offers actions. An
operator runs an action with inputs, such as an area or a building. The Plugin
uses its tools, often open-source services, to gather and return information.

## Where Plugins sit

- Plugins sit in the second ring of the
  [walled city](design-decisions.md#a-walled-city). They reach Core only through
  its Plugin interface, never its storage. Reading Entities or storing Objects
  goes through that interface. The Plugin interface is the Core API with a
  Plugin credential, not a second protocol. Plugins read the
  [shared picture](../core/docs/api.md#entities) and author geo features there.
- The Core API will carry Plugin calls. That is how the
  Command Interface uses a Plugin from outside the city.
- Operators call Plugins first. Assets will be able to call them later.
- Plugins do not direct Assets or issue Tasks.
- Fusion is not a Plugin. It runs inside the inner wall on every Observation.
  Nobody calls it.
- A feed that sends data all the time, such as an internet aircraft feed, is an
  Asset, not a Plugin.

## Actions

Each Plugin lists its actions, and each action takes its own inputs. An action
returns one of two kinds of output:

- **A list.** The output is the list itself, returned to the caller.
- **A reference.** The Plugin creates something in Core, such as an Object, a
  geo feature or another Entity, and the output names it. The result stays in
  Core, where the operator can find it later. Only fusion creates Tracks.

## Examples

### Find the buildings in an area

The operator passes a box and asks for every building in it. The Plugin asks
the Overpass API for OpenStreetMap structures in that box and returns them as
a list.

### Analyze a building

The operator picks a building and asks the Plugin to analyze it. The Plugin
runs whatever open-source tools it has. It creates a geo feature on the
building. Its findings never go on the geo feature. Depending on the action,
they come back as a list or as Objects attached to the geo feature. The output
is a reference to that geo feature.

### Gather imagery for an intelligence package

The operator passes an area and asks for satellite imagery of it. The Plugin
collects imagery available through its tools and stores it in Core, for example
as Objects. The output refers to what it stored.

### Ground elevation for an Asset (later)

An Asset sends its position and asks for the ground elevation there. The Asset
can use that elevation to calculate its height above the ground, whether it uses
a barometer or the altitude of its launch point.

### More Plugins that fit

- **Points of interest.** Takes a box and a kind, such as hospitals, helipads
  or open fields, and returns named positions found through Overpass.
- **Airspace.** Takes a box and returns airspace shapes with their altitude
  limits, from open airspace data.
- **Weather.** Takes a position and a time, and returns wind, visibility and
  cloud base from an open weather service.
- **What is this place.** Takes a position and returns its place name or address.
- **Line of sight.** Takes a position and a height, and creates a geo feature
  showing what can be seen from there.
- **Road route.** Takes two positions and returns the route between them as a
  line.

## Not Plugins

- **A live aircraft or ship feed.** It runs all the time, so it is an Asset.
- **Fusion.** Core runs it on every Observation.
- **A geofence alarm.** Nobody calls it; it reacts when a Track enters an area.
- **An auto-patrol that sends Tasks to drones.** It directs Assets.
- **Turning on Asset lights at dusk.** It changes Asset settings.
- **A radio bridge.** That is a gateway and its Fieldlink.
- **The Reset archive.** That is Core's own job.
- **Map styling.** That belongs to the Command Interface.

## Not decided

How the Command Interface shows Plugins and their results is not decided.
The Plugin interface, the Core API's Plugin calls, and how a Plugin is installed
and started are not designed yet. Each Plugin may run in its own container.

These cases are borderline and need a decision before such a Plugin is built:

- **Detecting objects in an uploaded photo.** The call fits, but the results
  would be Observations, which today come only from Assets.
- **A suggested flight path.** Returning positions fits. Sending the Tasks
  would direct Assets.
- **Repeating a call,** such as weather every 10 minutes. This starts to look
  like a Plugin running in the background.
