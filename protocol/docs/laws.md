# Protocol laws

The rules every Atlas message follows. If a change breaks a law, the change is wrong,
or the law gets changed on purpose first.

"Checked" means `npm run check` fails when the law is broken.

1. **Protocol guides storage.** Core, the SDK cache, and Assets store data built from these definitions: same variables, names, units, and shapes. Storage does not have to match the messages exactly. It may add its own fields (such as when a message arrived, or through which gateway) and combined views (such as an Asset's latest state), and those are defined here too. Storage never conflicts with the protocol: no renamed fields, different units, or different shapes for the same thing.
2. **Flat messages.** Every field sits directly in the message. No header, wrapper, or sender field. *Checked.*
3. **Every message starts the same way:** `type`, `time` (milliseconds since 1970, UTC), `seq` (the sender's own counter), and `asset_id`. *Checked.*
4. **Variables are the building blocks.** Each field is defined once, in `variables/`, and reused everywhere. Messages and components only point at variables or components. *Checked.*
5. **No redundancy.** Never send the same fact twice in one message, and never send what the other end can work out on its own.
6. **Full readable names.** Field names are whole words, such as `altitude_reference`. Short keys wait until protocol 1.0.
7. **Each command is its own message type.** No generic command message. A message's `type` is its file name. *Checked.*
8. **Fixed units.** Metres, metres per second, degrees from true north. Every altitude says what it is measured from.
9. **Settings are end states.** A setting says what it should be (`lights: on`), never "toggle" or "switch".
10. **No versions.** No backward-compatibility layers. Both ends check they have the same protocol when they connect and refuse a mismatch.
11. **Tools only display.** The CLI and the viewer read everything from `definitions/`, never name a message, and never send anything. *Checked by tests.*
12. **No size cap or chunking in the protocol.** Atlas runs over many links. Each link handles its own size limits, splitting, and compression.
13. **Easy to compress and split.** Keep structure predictable and fields small: text and lists have length limits, and there are no giant single fields such as embedded files. *Limits checked.*
