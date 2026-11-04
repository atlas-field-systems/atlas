# Protocol laws

The rules every Atlas message follows. If a change breaks a law, the change is wrong,
or the law gets changed on purpose first.

**Bloat is the enemy, but good organization is not bloat.** Every field, record and message must earn its place, and nothing is defined twice. For example, listing the same command kinds under two message types is bloat. Grouping messages into folders is not.

"Checked" means `npm run check` fails when the law is broken.

1. **Protocol defines all Atlas data.** It defines both the messages and the storage layout. Core, the SDK cache, and Assets store data in storage formats defined here, built from the same variables, names, units, and shapes. Extra stored fields, such as when a message was received, are defined here too. Storage formats are not planned yet; see [Storage formats](../storage/README.md).
2. **Flat messages.** Every field sits directly in the message. No header, wrapper, or sender field. The grouping lives only in the `type` name, never in nested objects. *Checked.*
3. **Every message starts the same way:** `type`, `time` (milliseconds since 1970, UTC), `seq` (the sender's own counter) and `asset_id`, then `kind` if its type has kinds. `asset_id` is required on every message that concerns a single Asset; a message about many Assets (such as asking Core for all of them) leaves it out. *Checked: the first three are required everywhere, and `asset_id` always comes from its variable.*
4. **Variables are the building blocks.** Each field is defined once, in `variables/`, and reused everywhere. Messages, kinds and components only point at variables or components. *Checked.*
5. **No redundancy.** Never send the same fact twice in one message, and never send what the other end can work out on its own.
6. **Full readable names.** Field names are whole words, such as `altitude_reference`. Short keys wait until protocol 1.0.
7. **Messages are grouped like folders.** A message's `type` is its group and type joined by a dot, matching its file `messages/<group>/<type>.json` (for example `control.command`). A type with several kinds requires `kind`, and each kind is its own file `messages/<group>/<type>/<kind>.json` whose name is the `kind` value. Kinds are unique within a type. *Checked.*
8. **Fixed units.** Metres, metres per second, degrees from true north. Every altitude says what it is measured from.
9. **Settings are end states.** A setting says what it should be (`lights: on`), never "toggle" or "switch".
10. **No versions.** No backward-compatibility layers. Both ends check they have the same protocol when they connect and refuse a mismatch.
11. **Tools only display.** The CLI and the viewer read everything from `definitions/`, never name a message, and never send anything. *Checked by tests.*
12. **No size cap or chunking in the protocol.** Atlas runs over many links. Each link handles its own size limits, splitting, and compression.
13. **Easy to compress and split.** Keep structure predictable and fields small: text and lists have length limits, and there are no giant single fields such as embedded files. *Limits checked.*
14. **Asset data reports are fixed.** Every Asset reports the same data the same way, using defined reports and components. No free-form or misc fields. New kinds of data get a new defined report.
15. **One command kind per action.** Each action is its own command kind even when its fields match another (a payload drop and `move_to` both take a position), because meaning and success differ and `hello` declares support per kind. Shared fields reuse the same definitions instead of copies.
16. **Assets observe; fusion decides tracks.** Assets send observations, never tracks. Tracks come only out of the fusion module.
17. **Keys only in the opening hello.** Asset and operator keys (and the enrollment key) travel only in the hello that opens a link, never in any other message. Core stores only their hashes and never sends a key, so the hello copies it stores leave keys out and it pushes them to operators as `admin.asset`. Keys are short (16 bytes).
18. **Tasks run in `task_seq` order.** A gap is waited for (bounded, then `query.queue`); a repeated `task_id` does nothing.
19. **Every failure has a defined safe response.** Each trigger has a response setting, and it overrides paused. Low battery can never be set to continue. An Asset never stays airborne until it falls.
20. **Routing belongs to links.** No message carries a route, hop or gateway field. A message seen twice (same sender, same `seq`) is handled once. Every message a sender sends gets a new `seq`, including Core's forwarded reports and repeats.
21. **Core answers every operator message.** One `admin.reply`, accepted or refused with a reason. Only the Asset's reports confirm an effect. For a query the reply comes after the answer and marks its end.
22. **One link per ID.** Each Asset and each operator interface has its own ID. If a second link opens with the same ID, the newer link replaces the older.
