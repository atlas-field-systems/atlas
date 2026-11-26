---
status: accepted
date: 2026-11-13
---

# Every file is an Object and goes through Core

Core holds every Atlas file as an Object, including photos and clips. An Asset sends any file requested by a Task with that Task, and chooses which other files to send from its configuration and available link.

Operators get files only through Core and cannot ask an Asset directly for an earlier file. To show a file at a place on the map, the Asset creates and links a geo feature explicitly.

Why: there is one place to look and one kind of file, and the Asset chooses when a file fits on the link, because a pull from the operator would compete with commands and fails once the Asset is offline.

Rules: [Objects](../../core/docs/api.md#objects), [Capture files](../../asset/docs/README.md#capture-files)
