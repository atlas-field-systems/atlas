# Plugins

This page records the owner's intended use. Plugins are part of the product and
are built with the rest of it. No Plugin exists yet.

A Plugin is a small program that runs beside Core and offers actions. An
operator runs an action with inputs, such as an area or a building. The Plugin
uses its tools, often open-source services, to gather and return information.

## Where Plugins sit

- Plugins sit in the second ring of the
  [walled city](design-decisions.md#a-walled-city). Each one runs on its own, in
  its own container if it needs one, and connects out to Core with a key an
  admin gave it. It reaches Core only through its Plugin interface, never its
  storage. The Plugin interface is the Core API with a Plugin key, not a second
  protocol. Reading the
  [shared picture](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#entities),
  creating geo features, and storing Objects go through that interface.
- The Core API carries Plugin calls. That is how the Command Interface uses a
  Plugin from outside the city. The [Core API](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#plugins)
  has the calls.
- Operators call Plugins first. Assets will be able to call them later.
- Plugins do not direct Assets or issue Tasks.
- Fusion is not a Plugin. It runs inside the inner wall on every Observation.
  Nobody calls it.
- A feed that sends data all the time, such as an internet aircraft feed, is an
  Asset, not a Plugin.

## Actions

Each Plugin lists its actions, and each action takes its own inputs. Protocol
defines every action's inputs and its list output, so Core checks a call and its
answer the same way it checks a Task. An action returns one of two kinds of
output, or both:

- **A list.** The output is the list itself, returned to the caller.
- **A reference.** The Plugin creates geo features or Objects in Core, and the
  output names them. The result stays in Core, where the operator can find it
  later. Plugins create nothing else: Observations come only from Assets, and
  only Fusion creates Tracks.

## What the operator sees

- **Only Plugins that are running can be used.** If a Plugin is not connected,
  Atlas says so at once. Nothing waits and runs later.
- **A call ends with a result or a failure.** If a Plugin fails or disconnects
  partway, whatever it already stored stays, and the call is marked not
  finished. Nothing reruns by itself; the operator calls again if they still
  want it.
- **There is no stop.** An operator who no longer wants an answer ignores it.
- **Everyone sees every call.** Every logged-in operator sees every Plugin call
  and its result, because Atlas keeps one shared picture and one history.
- **Calls are not repeated.** The operator runs a call again when they want new
  data.

## Objects

An Object is a file Core holds, such as a photo or a satellite image. Plugins
and operators add them. An operator can attach a photo to a building's geo
feature, for example.

- A file never changes. An operator can move an Object to another geo feature
  or detach it, and can delete it. History keeps the record that it was stored
  and who deleted it.
- An Object belongs to at most one geo feature. Deleting the geo feature leaves
  its Objects.
- A file may be at most 100 MB unless an admin changes the limit.
- Files from Assets, such as drone photos, are not designed yet.

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

## Not Plugins

- **A live aircraft or ship feed.** It runs all the time, so it is an Asset.
- **Fusion.** Core runs it on every Observation.
- **A geofence alarm.** Nobody calls it; it reacts when a Track enters an area.
- **An auto-patrol that sends Tasks to drones.** It directs Assets.
- **A suggested flight path.** A Plugin does not return a route or positions
  meant to be turned into Tasks.
- **Repeating a call,** such as weather every 10 minutes. The operator calls
  again when they want new data.
- **Turning on Asset lights at dusk.** It changes Asset settings.
- **A radio bridge.** That is a gateway and its Fieldlink.
- **The Reset archive.** That is Core's own job.
- **Map styling.** That belongs to the Command Interface.

## Not decided

[Plugins and Objects in the interface](https://github.com/atlas-field-systems/atlas/blob/main/command-interface/docs/plugins-and-objects.md)
shows how operators run Plugins and see their results and Objects. A new Plugin
needs no change to the Command Interface. Which actions Protocol defines first is not decided.

This case is borderline and needs a decision before such a Plugin is built:

- **Detecting objects in an uploaded photo.** The call fits, but the results
  would be Observations, which today come only from Assets.
