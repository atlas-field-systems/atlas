# Final prototyping findings

## Outcome

The broad throwaway prototyping phase is complete. Three rounds tested delivery,
Asset failure behavior, diagnostics, retention, network recovery, Reset, storage,
and Plugin execution. The complete-queue workflow and separation of Core, SDK,
and Asset responsibilities remain credible under the tested conditions.

The owner is moving next to documenting what Assets are and how they work.
Those stories will guide changes across Core, SDK, and Protocol. Detailed failure
policy is deferred until that model is clearer. No prototype runtime is adopted.

## What held up

- Complete lists did not activate until all Task bodies arrived. Missing-body
  retries recovered the tested missions after loss and reordering.
- Clear invalidated waiting pre-clear lists as well as current work. Cancel
  intentionally paused while retaining unstarted Tasks.
- Retained Task records prevented repeated execution. Final reports retried
  unchanged and stopped on the matching acknowledgement. Reconnecting links
  preserved state in the same running processes.
- Immediate settings applied at receipt; queued settings applied at execution.
  Partial reports merged per setting, including reordered and equal-time reports.
- Simulated fleet schedules preserved attribution and history for 20 Assets.
  This tested bookkeeping, not radio capacity or physical flight behavior.

## Findings and current direction

### Duplicate prevention and retention

A bounded identity cache forgot an old immediate request after enough newer
traffic. Replaying the original bytes then repeated its effect after intervening
state changes. A separately bounded answer cache could also forget an answer
while the request remained recognized, leaving its retries unanswered.

Keep handled side-effecting identities and original correlated answers together
as the provisional implementation baseline. Retained Task records protect queued
execution separately. The owner will measure practical retention needs and costs
with detailed logs and integration tests of the real components, including
boundary stress. No exact window or storage budget is selected. Larger caches
alone do not establish an unconditional no-repeat guarantee.

### Reset and archive cleanup

Draining controlled queues or closing old transport handles did not prevent an
old request arriving through a fresh path after its identity was forgotten.
Retaining handled-effect records suppressed the tested replay.

Exporting a snapshot and then deleting all live records lost events created
while export ran. Verifying the archive and deleting only its included local
prefix preserved those later events. Failed exports retained their sources.
These cuts were local prefixes, not a globally atomic snapshot.

Reset is expected to be infrequent. Its semantics, record release, Task-ID reuse,
and handling of unavailable participants remain open. Exporting without clearing
handled-effect records is a proposal, not an approved Reset contract. Continuous
retention has storage and finite-ID costs across Core's all-day operation.

### Asset failures

Indefinite low-battery hold supplied no autonomous exit. Explicit battery priority
avoided the tested case where later link loss replaced battery landing with
return-home. This does not establish safe reserves, timeouts, or landing sites,
or a priority ranking for every equipment failure.

Deferred Asset decisions include hold exit, competing-failure priority, failed-Task
responses, active-response reconfiguration, and recovery. A tested provisional
policy captured configuration at the trigger and left the Asset paused after
failures cleared. Dispatching a safe response was distinct from observing its
physical result. These choices belong in [Asset behavior](../../../asset/docs/README.md)
and [configuration](../../../asset/config.md).

### Logging

A synchronous try/catch did not consume rejected promises from async observers;
a strict Node subprocess exited. Explicit rejection handling contained the error.
Bounding only the host writer still allowed upstream SDK callbacks to accumulate.
Bound source delivery too, and keep loss accounting outside the overflowing queue.

Finite nonblocking recording cannot guarantee a complete transcript through an
arbitrary sink outage. A valid ZIP can be incomplete. Preserve sources after
failed export and disclose lost or filtered evidence. Raw invalid-input capture
needs an explicit size and credential-redaction policy; metadata is the proposed
conservative default.

Atlas operates in a trusted setting. These were stress cases, not predictions of
normal use. Detailed local logging with practical limits and ordinary error
handling is the starting direction. Exact limits remain open in the component
configuration docs: [Core](../../config.md), [Asset](../../../asset/config.md),
and [SDK](../../../sdk/config.md).

### Settings and ordering

The owner accepts the simple settings direction. Immediate changes apply in Asset
receipt order alongside local changes; queued changes apply when their Task runs.
Failures override ordinary settings. An unseen delayed request can therefore
supersede a newer local change; that is receipt-order behavior, not failed dedupe.

Keep confirmed values per setting using the reporting Asset's time and sequence.
A single latest partial report is not a complete settings snapshot. Explicit
receipt order is recommended for replacing waiting queue edits. Per-field Asset
measurement time and sequence is recommended for observation details, including
null clears. These details need to be written precisely in the owning contracts;
no ordering across different Assets' clocks was established.

### Storage

The owner accepts direct domain storage as the starting direction. All three
SQLite candidates returned the expected tested state; no performance winner was
measured. Retain original reports and per-field provenance alongside projections.
Unique stored identities prevented duplicate history after SDK cache eviction.

Unseen older telemetry still belongs in history and live delivery even when the
latest picture stays unchanged. Contradictory Task finals remain evidence without
replacing Core's first recorded final; rebuilding from timestamp order alone can
change that authority. Replay must preserve original frames rather than serialize
replacement objects.

Bounded keyset pages replaced an eager full-result history buffer without changing
its output. A fixed historical snapshot plus separately merged live reports is
the recommended query policy, still to be specified. Page limits do not bound
internal query work or the caller's accumulated result.

### Plugins and observed outcomes

The owner accepts worker execution for CPU-capable Plugins. An async queue still
blocked Core during arithmetic; workers preserved the tested callbacks. Start
with one worker and a small bounded queue. Another worker removed a demonstrated
short-call wait, but resources, shared-state ownership, call duration, abandoned
work, result limits, and completed-answer retention still need concrete policies.
Workers are not a security sandbox.

The owner also accepts keeping acceptance distinct from observed execution.
Across real sockets, Core could accept an immediate command while the Asset
still awaited its lost connect acknowledgement and dropped the command. Queued
work later recovered. Preserve the unobserved outcome rather than manufacture
success or rebuild an uncertain command as a new request. An open upstream socket
also did not prove fresh Asset contact.

## Evidence and code boundaries

The experiments used current Protocol definitions, event models, independent
Node processes, binary WebSockets and real timers, actual SQLite stores, CPU
workers, filesystem faults, and independently checked ZIPs. Some passing
assertions deliberately reproduced counterexamples. Validator-call counts were
not counts of independent guarantees.

No experiment establishes physical flight safety, radio capacity, security,
total memory bounds, durability, complete fusion, or universal Reset isolation.
There is no complete current SDK/Core/Asset implementation. Participants stayed
running; process restart recovery was outside the intended scope.

The retained Core runtime remains a historical prototype on an older Protocol
pin. Protocol's loader and validators remain maintained tooling. SDK and Asset
runtime models were disposable, and Command Interface was not implemented.
Current Protocol definitions carry no protocol version; its future published
package version identifies the release. The historical Core pin remains isolated.

Detailed reports and raw evidence are preserved outside this PR and in the
original experiment worktrees. The source baselines were `75d71ae`, `de477a8`,
and `b89547c`. This report retains the lessons; it is not an executable reproducer.

## Next work

Document the Asset model and concrete operator stories first. Reconcile affected
contracts as those stories become clear, then write the short system-wide build
brief. Deferred choices block their affected behavior, not unrelated SDK work.

Build through the shared SDK front door and check the implementation against the
retained cases: eviction and replay, missing bodies, clear while waiting, final
acknowledgements, partial settings, logger failures, and events during export.
Add equipment and radio tests when those integrations exist. Reopen a narrow
prototype only for a concrete unresolved question rather than another broad round.
