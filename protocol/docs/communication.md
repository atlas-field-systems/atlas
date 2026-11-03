# How Atlas parts communicate

> **Draft proposal for developer review.** Nothing here is decided until the developer approves it.

## One model for every link

Every link is a **two-way message stream**, like a chat. Either side sends a
message whenever it has something to say. Nothing has to wait for a reply.

- Over IP (Core, gateways, apps), the stream is a **WebSocket**.
- Over radio, the stream is the **mesh link**.
- The **gateway bridges** the two. It passes the same protocol messages along.
  Packaging and compression may differ per link; the messages do not.

Details that belong to one medium (size limits, chunking, compression, timing)
live in a **link profile** for that medium, not in the messages.

## Opening a connection

1. The WebSocket (or radio link) opens.
2. The two sides exchange a **hello**: protocol version and `asset_id`, with
   authentication. Leaning toward API keys. Challenge codes are a possible later
   alternative.
3. A version mismatch is refused with a clear "update this device" error.
   After the hello, no message carries a version.

## Push, and asking

- Core **pushes** tasks and settings to an Asset when they change.
- An Asset may also **ask**, for example "send me my tasks" after reconnecting.
  Core answers with the same push messages.
- Both directions use the same messages. There is no separate request/response format.

## Delivering a task queue

Sending a whole queue at once could fail on a slow link. Instead:

1. Core sends **each task as its own message** (a `control.command` with a `task_id`).
2. The Asset reports its **queue**: the list of task IDs it holds, in order.
3. Core resends any task missing from that list. Core can ask for the queue at any time.

## Task states

`queued`, `active`, `completed`, `failed`, `cancelled`.
Only reports from the Asset move a task forward. Core never assumes progress from
silence or position.

## Is an Asset reachable?

Its regular status reports are the proof. If it is silent longer than the link's
expected interval (set in the link profile), it is shown as stale.

## What goes on the stream

Everything except large files, such as object files. Large files use a separate
file transfer. Over IP, bandwidth efficiency does not matter for now.

## SDK

Keep these ideas from the old SDK and cut the rest:

- Commands are read from Protocol, never hardcoded.
- An Asset-side client.
- Recovery after reconnecting.
- Every send ends as one of: **accepted**, **rejected**, or **no answer yet**.

## Escape hatches

How this avoids locking Atlas in:

- **Messages are independent of the link.** A new radio or transport only needs a
  new link profile.
- **Link profiles are swappable.** Changing compression or chunking on one link
  touches nothing else.
- **No message assumes request/response.** Because everything is a one-way
  message on a stream, the same messages work over HTTP, a queue, or store-and-forward
  later if needed.
