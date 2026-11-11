# Parked definitions

The gimbal definition waits here until it is reworked into a record. It is
part of the product, which is
[designed whole](../../atlas/design-decisions.md#design-the-whole-product-then-build-it).
It keeps the layout of `definitions/` but is not listed in its `index.json`,
not checked, and not shown by the tools. It still uses the earlier message shape
(`seq`, `from`, replies, and hello references), and its references point at
variables that may have moved or been removed. To bring it back, rework it into a
record under `definitions/` that passes `npm run check`. Update the existing
records as needed: `geofeature_id` on `move_to` and `land`, and the `gimbal`
report in the description. Git history keeps the decisions and storage notes
that went with them.
