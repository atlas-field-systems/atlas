# Runs and identity

What a run is, what Reset does, what carries over, and how Assets get and keep
their IDs. This page owns those rules. The [Core API](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/api.md#asset-and-gateway-calls)
has the calls behind them, [Core Reset](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/reset.md) the ZIP, and
[Gateway](https://github.com/atlas-field-systems/atlas/blob/main/gateway/README.md) what every Fieldlink provides. The
[decision log](decision-log.md#runs-and-identity) dates each decision.

## A run and Reset

- **A run** lasts from one start of Core to the next stop.
- **Stopping Core is Reset.** There is no Reset request, API call, or button.
  The admin stops Core on its own computer. The operator is trusted to shut the
  Assets down first; Core does not check. An Asset left running into the next
  run is not supported.
- **No retention.** Core writes its Reset ZIP, checks it, and only then deletes
  the run's data. The ZIP is then the only copy of the run, and nothing deletes
  a ZIP automatically. If the ZIP fails, Core deletes nothing and tries again at
  its next start, but never serves that run through the Core API. A crash ends
  the run too; the next start writes its ZIP, marked as possibly incomplete.
- **Everyone signs in again.** Every session ends with the run.
- **Operator state is discarded.** Shared links, hidden Tracks and other view
  filters, drafts, and result overlays belong to one run. A link names its run,
  and a link from an ended run never opens an item of the new run.
- **Each part writes its own ZIP:** [Core](https://github.com/atlas-field-systems/atlas/blob/main/core/docs/reset.md),
  [each Asset](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/logging.md#export-the-assets-reset-zip), and
  [each gateway](https://github.com/atlas-field-systems/atlas/blob/main/gateway/README.md#the-gateways-reset-zip). Merging them is
  a separate process.

Scope: only stopping Core ends a run. Within a run nothing in the picture
expires, a dropped link does not end anything, and a gateway swap is not a new
run.

## What carries over

| Carried to the next run | Not carried |
| --- | --- |
| Accounts | Asset IDs, and every other run ID: Task, Track, geo feature, and Object |
| Connection keys: for Assets on IP, gateways, and Plugins | The picture: Assets, Observations, Tracks, places, and Objects, and their history |
| Installed Plugin setup | Operator state: sessions, links, and view filters |

`event_id` keeps rising across runs, so an old cursor never matches a new
event.

## IDs

- **Core assigns every `asset_id`** when the Asset registers, every run, and
  the acknowledgement tells the registrant: the Asset on IP, or the gateway for
  a radio Asset. Nothing picks its own `asset_id`, and no configuration holds
  one.
- **Assets choose `observation_id`**, unique for that Asset within a run.
- **Core assigns the other IDs:** `task_id`, `track_id`, `geofeature_id`, and
  `object_id`. They start again each run, so the same ID can name a different
  item in the next run.

Scope: an ID holds for one run. Within the run an Asset keeps its `asset_id`
through reconnects, app restarts, and gateway swaps; in the next run it gets a
new one.

## Keys and registration

- **Admins hand out keys, not IDs.** An admin creates a key for each Asset on
  IP, gateway, and Plugin and copies it into that program's configuration.
  An Asset key names no Asset. There is no enrollment key.
- **An Asset on IP registers itself** with its key when it starts. Each key
  registers at most one Asset at a time. Registering again with the same key in
  the same run returns the same `asset_id`, unless an admin removed that Asset;
  then it registers as a new Asset with a new ID.
- **A restarted app rejoins as itself.** If an Asset's app stops and starts
  again during a run, it registers with its key and comes back as the same
  Asset, with the same `asset_id` and its unfinished work. This holds even if it
  forgot its ID: the key proves which Asset it is. It still never picks or
  configures its own ID.
- **A removed Asset's ID ends.** If it registers again, it is a new Asset.

## Radio Assets

- **The gateway is an IP bridge.** A radio Asset holds no Core key and never
  calls the Core API. It authenticates to its gateway through its Fieldlink.
  Radio identity stays on the gateway side; Core knows radio Assets only by
  `asset_id`.
- **No advance setup.** The gateway registers a radio the first time it hears
  it in the run. Core assigns its `asset_id`, and the gateway tells the radio.
  There is no approval step.
- **A removed radio can come back.** If it is heard again, the gateway
  registers it as a new Asset with a new ID.
- **One gateway per site** at a time ([Scale](scale.md#setup)).

## When the gateway changes

- **Swapped mid-run.** Radios stay the same Assets. Each tells the new gateway
  its `asset_id` and keeps it and its unfinished work. The new gateway takes a
  radio over only when its old carrier is offline, removed, or none.
- **Removed and not replaced.** Its radio Assets stay in the picture, offline,
  as the same Assets, carried by no gateway until another one hears them.
- **Key replaced.** The radios are unaffected.

Scope: these hold within a run. In the next run every radio registers again as
a new Asset.

## Open

- How a restarted Asset app gets its unfinished work back from Core.
- Whether a radio Asset whose app restarts mid-run gets its old ID back. Its
  gateway would hear the same Fieldlink identity, but no key proves it to Core.
