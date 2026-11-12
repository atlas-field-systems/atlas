# Throwaway v2 lessons: do not merge

Source revision: `cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a`. Remote main matched it at start.
Built from docs only, without reading, copying, or merging PR #27.
Product docs remain unchanged. No product decision is made here.

Validation: 27 tests passed, zero failed or skipped. Of those, 24 exercise
behavior, one checks Plugin list validation only, and two reproduce doc conflicts.
Strict TypeScript, repository link checks and retired-phrase checks passed.
Run commands and limits are in `spike/README.md`. No hardware or SITL was used.

## Real doc conflicts

1. Registration requires the ID it is meant to allocate. [core/docs/api.md:267](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L267)
   says POST takes the description record before returning Core's ID.
   [protocol/definitions/records/description.json:9](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/protocol/definitions/records/description.json#L9) requires `asset_id` in
   that description. A valid first request cannot be constructed without
   inventing an ID. The first conflict probe reproduces rejection without it.
   The spike sends `TEMP` to pass shape validation and overwrites it with Core's
   allocation. Proposed doc fix: specify a registration request without an ID,
   keeping the description record for the identified Asset. Owner review needed.
2. The description cannot advertise all six commands. The five-command limit at
   [protocol/definitions/records/description.json:38](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/protocol/definitions/records/description.json#L38) prevents an Asset from
   listing the five example flight commands plus Fail-safe, which
   [asset/docs/failsafes.md:241](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L241) requires it to advertise. The second probe
   reproduces this. The spike runs two five-command fixture variants. Proposed
   fix: reconcile the bound with the supported command set.
3. The general design page still calls every stop Reset at
   [atlas/design-decisions.md:110](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/atlas/design-decisions.md#L110), but the authoritative decision at
   [atlas/decision-log.md:20](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/atlas/decision-log.md#L20) says only a deliberate stop resets; a crash
   resumes. The implementation follows the decision, and process tests confirm
   its chosen behavior. Proposed fix: add “deliberate” to the general description.
   This is a wording conflict resolved by existing authority, not an owner question.

## Omissions

- Restart reporting is explicitly open at [atlas/runs-and-identity.md:120](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/atlas/runs-and-identity.md#L120).
  The double cancels remembered unfinished Tasks on a manual ground restart.
  This does not solve an app that lost its local queue or final reports. Which
  exact reports must the restarted app send, and how does Core reconcile unknown
  work without claiming an observed outcome? Document that exchange before build.
- Compatibility names a hash at [core/docs/api.md:17](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L17) and the SDK expects
  its package to supply it at [sdk/docs/client.md:26](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/sdk/docs/client.md#L26), but these passages
  specify no canonical bytes or hashing recipe. The spike hashes sorted file
  names and source bytes. Specify the recipe and a test vector so independently
  built components agree. This is a stand-in, not an interop result.
- [asset/docs/failsafes.md:218](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L218) says critical rules always fire, while
  Land/Return home overrides stand. [asset/docs/failsafes.md:265](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L265) leaves
  higher-priority interactions with overrides open. Which response wins when
  several critical rules match, and does a continuously true critical condition
  create a new attempt after an unsuccessful response? The spike uses descending
  priority among matches, interrupts a noncritical response, and suppresses
  duplicate activation of that same response until an override. Those choices
  are provisional. Add a transition example before prescribing implementation.
- The 100 MB default at [core/config.md:28](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/config.md#L28) has no byte value there. The
  spike uses 100,000,000 bytes, with exact-limit acceptance and one-byte-over
  rejection. Confirm that value and state it in the owning configuration doc.
- ID wording needs an explicit distinction. [atlas/runs-and-identity.md:57](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/atlas/runs-and-identity.md#L57)
  allows the other IDs to restart each run, while
  [atlas/decision-log.md:26](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/atlas/decision-log.md#L26) requires a new Asset ID. During implementation,
  applying one per-run allocator to all kinds would have reused an Asset ID.
  The spike instead keeps a global Asset allocation counter and tests a different
  Asset ID after Reset. Add an Asset-specific example to prevent that mistake.
  What should happen after the four-character ID space is exhausted? The spike
  refuses registration, without claiming that as a product decision.

Open questions above are for the owner. Suggested edits are proposals only.

## Spike shortcuts

- [core/docs/api.md:78](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L78) specifies cookies, scrypt, and issuance. The spike
  provisions random fixture bearer credentials out of band, stores only their
  hashes, and uses loopback HTTP rather than TLS. No login/session, rotation, or
  credential-issuance implementation is claimed. Accounts and session recovery
  remain untested. Raw credential absence is checked in the archive.
- [core/docs/api.md:108](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L108) requires Protocol event bodies. Many spike event
  envelopes are abbreviated, and recovery uses a `spike.recovery` diagnostic
  event. Request bodies, Task records, and incoming reports use the one Protocol
  validator; not every emitted event has full conformance coverage. Local
  TypeScript projections are partial and handwritten, never generated records.
- [core/docs/storage.md:7](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/storage.md#L7) calls for ordinary pillar tables. The spike uses
  one current-state JSON table keyed by kind, with separate event, retry, run,
  and allocation tables. State and event changes are atomic SQLite transactions,
  not event replay. It is one Core process, not a multi-writer service test.
- [core/docs/reset.md:47](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/reset.md#L47) defines a richer ZIP. This spike writes real ZIPs,
  checks each file size and SHA-256 before clear, retains deleted Object bytes,
  and tests failed writing and interruption during export. Archive names, summaries,
  diagnostics, configuration, and versions are abbreviated. There are no Asset
  or gateway ZIPs. [gateway/README.md:80](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/gateway/README.md#L80) owns the latter. A blocked temporary
  path stands in for an export I/O failure; real disk exhaustion is untested.
- [core/docs/api.md:225](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L225) specifies unanswered-request dropping and reconciliation.
  This spike does not implement that delivery lifecycle, retention acknowledgments,
  or queue reconciliation. Offline admission is tested using an expired contact
  timestamp, not a minute of wall-clock waiting. Gateway expiry, removal and its
  old Assets going offline on replacement are not fully implemented. Mesh tests
  prove new IDs and ownership refusal, not the complete replacement workflow.
- [gateway/README.md:41](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/gateway/README.md#L41) specifies Fieldlink authentication; its design is
  deferred at [gateway/README.md:155](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/gateway/README.md#L155). The double uses Ed25519 signatures,
  sequence rejection, and a graph path through a peer Asset to one gateway. It
  tests spoofing, replay, refusal and rejoin. It does not implement Meshtastic,
  encoding, airtime, loss/retry scheduling, durable gateway identity, or capacity.
- [asset/docs/failsafes.md:65](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L65) requires independent controller protection.
  The double uses a five-second synthetic heartbeat timeout and returns a mode
  string. No real landing or return is established. No automatic app restart
  exists. Ground restart is manual, and its reports depend on retained memory.
- The full policy conditions at [asset/docs/failsafes.md:106](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L106) exceed this
  double's battery, contact, airborne and commanded inputs. Time and contact
  thresholds are supplied as deterministic inputs. Polygon, idle, missing-data,
  subsystem conditions, fallback execution, equipment-specific completion, and
  shutdown/report-ack timing are not implemented. Failsafe responses are local
  state, not complete Protocol failsafe reports.
- The complete picture/imagery behavior at [core/docs/api.md:468](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L468) is outside
  this probe. It tests point snapshots, explicit yes/no updates, active retargeting,
  and deletion preserving Tasks. It does not implement a map UI, imagery checks,
  Fusion, or a complete Objects attachment API. Nonpoint replacement update behavior
  is provisional; no product rule is inferred from it.
- [core/docs/api.md:650](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L650) requires complete Plugin answer lists. The suite
  checks 1000/1001 through Protocol's validator, not a Plugin HTTP service. History
  paging tests 1000 items and cursor continuation, but ordering/filtering is
  simplified to event order, unlike the report-time ordering at
  [core/docs/api.md:247](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/core/docs/api.md#L247). Object size tests store real 100 MB bytes through
  Core, not through the upload transport; small uploads use real HTTP.

Spike bugs found and fixed: duplicate active delivery restarted its executor,
contrary to [asset/docs/README.md:100](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/README.md#L100); critical battery initially obeyed
ordinary priority escalation, contrary to [asset/docs/failsafes.md:218](https://github.com/atlas-field-systems/atlas/blob/cd25d25cd5d2aab0b8a4e9a5c193f54aa6ca047a/asset/docs/failsafes.md#L218);
Node strip-only mode rejected parameter properties; and the Plugin test fixture
used `value` instead of the defined `text` plus omitted `type`. None is evidence
of a design failure. Passing reruns, not the failures, establish the limited
behavior above. An explicit ID example and critical-rule transition table would
have helped prevent the two implementation near misses; the duplicate rule was
already clear and needed no new product decision.
