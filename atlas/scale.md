# Scale

These numbers guide Atlas design. They are not hard limits.
Design so Atlas works well at these sizes and does not break just past them.

## Fleet
- Atlas has no set fleet size. An early figure of about 20 Assets was a rough guess, not a requirement or a test. A field link carries as many Assets as still meet the [operator deadlines](#operator-deadlines-come-first).
- IDs that people read or that cross a field link are 1 to 4 letters or digits, such as `A1` ([the ID rule](CHARTER.md#keep-shared-data-simple)). That gives over a million IDs and keeps field-link frames short.

## Setup
- A Core may run several gateways at once, as long as their radio links cannot clash: gateways in different areas, such as two gateways 20 miles apart, or gateways in one area on different bands, such as an FLRC gateway beside a Meshtastic gateway. Each radio network has exactly one gateway, and the network is a mesh of Assets. An Asset always uses exactly one gateway. Different gateways may use different designs ([Environment](environment.md)).
- In practice, one operator runs Atlas at a time.

## Radio
- Links start with pure LoRa, then move to a multi-layer mesh with FLRC between Assets wherever FLRC is viable ([Environment](environment.md#connectivity-evolves)).
- Each Fieldlink sets its own size limit and splits records into chunks if it needs to. Protocol records have no size cap and no chunking.
- Expect a few Tasks or settings changes per minute per Asset.

### Operator deadlines come first

An operator sees a command start, and sees an Asset go offline, within about
10 s and never more than 15 s ([ADR-0021](https://github.com/atlas-field-systems/atlas/blob/main/docs/adr/0021-operator-deadlines-come-first-then-fill-the-link.md)).
On a slow link such as LoRa, airtime is scarce, and these deadlines decide how
it is spent.

- **Deadlines first.** Commands, the Task-started report, and contact proof go
  first. Telemetry never makes them wait.
- **Telemetry fills what is left.** There is no fixed telemetry rate: an Asset
  reports as often as the leftover airtime allows, more often on a quiet link
  and less often on a busy one.
- **Spend every byte well.** Airtime never carries data that is already out of
  date or that the other end already has.
- **No fleet-size target.** A link carries as many Assets as still meet the
  deadlines.

[Asset communications](https://github.com/atlas-field-systems/atlas/blob/main/asset/docs/communications.md#report-from-local-state)
owns what an Asset chooses to send, and each Fieldlink owns how compactly it
carries it ([Fieldlink](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/README.md#the-fieldlink-moves-messages-the-asset-decides)).

## Storage
- Core should run all day without a Reset.
- Size is not a concern. The owner deletes old Reset ZIPs by hand.
