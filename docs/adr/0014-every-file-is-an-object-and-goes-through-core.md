---
status: accepted
date: 2026-11-13
---

# Every file is an Object and goes through Core

Core holds every Atlas file as an Object, including photos and clips. A Capture Task completes once the photo or clip is taken and stored on the Asset; the Asset sends captured files to Core when its configuration and available link allow, never holding up or failing a Task on upload.

Operators get files only through Core and cannot ask an Asset directly for an earlier file. To show a file at a place on the map, the Asset creates and links a geo feature explicitly.

Why: there is one place to look and one kind of file, and the Asset chooses when a file fits on the link, because a pull from the operator would compete with commands and fails once the Asset is offline.

Rules: [Objects](../../core/docs/api.md#objects), [Capture files](../../asset/docs/README.md#capture-files)
