# Independent design probes

These probes use the documents at `45bd0261c3bed2257e5290e4cc15fc59e0ba94a7`.
They characterize contracts and limits. A passing probe does not prove Atlas works.

Run `node --test spike/test/design-probes.test.ts` from the repository root.
The tests hand-author scenarios from the owning behavior docs and call Protocol's
existing validator. They do not generate tests or code from definitions.

## Confirmed design problem: accepted work can outgrow the queue report

A paused Asset can hold 65 Tasks accepted in separate requests. Core sends each
accepted Task immediately, and the Asset must acknowledge the complete held queue.
The owning rules specify no bound on outstanding Tasks or queue-capacity admission.

Sources:

- [Core API, Operator requests](../core/docs/api.md#operator-requests) assigns each
  accepted Task a number, sends every Task immediately, and requires a queue report.
- [Asset behavior, The queue](../asset/docs/README.md#the-queue) requires the Asset
  to hold received work and run it in number order.
- [Asset behavior, Pause](../asset/docs/README.md#pause) prevents advancing the queue
  while paused, so all 65 can remain queued.
- [Protocol laws, law 9](../protocol/docs/laws.md) requires limits rather than
  Protocol chunking.
- [Queue report, task_ids](../protocol/definitions/records/report/status/queue.json)
  describes every held, unstarted Task and limits the array to 64 entries.
- [Executable probe](test/design-probes.test.ts) validates 65 individually valid
  Tasks, accepts a 64-entry queue report, and rejects the complete 65-entry report.

Impact: an Asset that obeys the execution rules cannot send a valid full queue
acknowledgment once enough accepted work accumulates. Truncating the report would
misrepresent held work. Dropping the unanswered request later would not prove the
Task never arrived, as the API itself explains.

Proposed decision for the developer: define an outstanding-work bound with atomic
Core admission and its refusal behavior, or change the report contract so all
allowed held queues can be represented. A per-request Task count alone cannot
solve accumulation across requests. Capacity checks must account for in-flight
accepted work, not only the last queue snapshot. Do not silently add chunking or
change the limit inside this spike.

## Documented boundary: Task IDs exhaust within a run

[Protocol laws, law 10](../protocol/docs/laws.md) explicitly bounds Task IDs at
9999. [Core API, Operator requests](../core/docs/api.md#operator-requests) prohibits
reuse within the run. The second executable probe verifies acceptance of Task 9999
and rejection of Task 10000.

This is a known boundary, not a newly confirmed design defect. The normal workload
in [Scale, Radio](../atlas/scale.md#radio) is a few Tasks per minute per Asset.
Reset is not designed yet under [Core API, Not defined yet](../core/docs/api.md#not-defined-yet).
The spike must refuse exhausted IDs rather than wrap them. No follow-up issue is
justified solely by this probe.

## Incomplete docs and minor wording differences

[Protocol open questions, Unresolved](../protocol/docs/open-questions.md#unresolved)
already lists settings-support advertisement, request bodies, definitions-hash
coverage, subsystem conditions, failsafe records, pause reporting, and TypeScript
record types. These are existing incomplete contracts, not new findings.

The API says every Task carries `send_last`, while
[the variable definition](../protocol/definitions/variables/send_last.json)
explicitly permits omission for a Task sent alone. The default is unambiguous, so
this is wording alignment rather than a demonstrated execution flaw. A Core may
always send the field to satisfy both texts. No independent follow-up issue is
justified by this difference.

## Limits of the evidence

The queue probe runs the real validator, not a full Asset and Core exchange.
The behavioral path to 65 held Tasks follows the cited rules. Integration tests
must separately check whether the spike adds a provisional capacity restriction.
Any such restriction belongs in the lessons report as a spike stand-in; it does
not resolve the documented contract.
