# Parked definitions

Geo feature, Object, Plugin, Observation, and gimbal definitions wait here until
after first flight, when [scope reopens](../../atlas/design-decisions.md#first-flight-comes-first).
They keep the layout of `definitions/` but are not listed in its `index.json`,
not checked, and not shown by the tools. They still use the earlier message shape
(`seq`, `from`, replies, and hello references), and their references point at
variables that may have moved or gone. Each returns by being reworked into a
record under `definitions/` that passes `npm run check`, along with what it needs
from the records that stayed: `geofeature_id` on `move_to` and `land`, the
`gimbal` and `observation` reports in the description, and `null` in
`entity_type` for clearing an observation's value. Git history keeps the
decisions and storage notes that went with them.
