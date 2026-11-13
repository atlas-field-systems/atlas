# Plugins and Objects in the interface

This page records selected behavior for how operators use
[Plugins](../../atlas/plugins.md) and [Objects](../../core/docs/api.md#objects).
No interface code exists yet. The calls are in the
[Core API](../../core/docs/api.md#plugins).

## New Plugins need no interface change

The interface builds every Plugin action's form, its place in the menus, and
its result view from the action's description. Adding a Plugin or an action
never needs a change to the interface. When a Plugin needs a kind of input,
result, or display that the interface does not know yet, that kind is added
once, and every Plugin can then use it.

Each Plugin's description also carries its display choices. They ship with the
Plugin, and admins only add and remove Plugins. Every choice has a default, so
a Plugin that sets none still works. For each action:

- its label and help text;
- whether its action appears in the right-click menu of an area, a place, or a
  point on the map. Off unless the Plugin turns it on. It appears only when the
  action has exactly one input of the clicked kind, which the clicked item
  fills;
- whether listed results with a position show on the map by default. Off unless
  the Plugin turns it on.

A Plugin cannot bring its own screens or code into the interface. Custom
Plugin screens are a possible later step, not part of the first build.

## Run a Plugin

Operators start a Plugin action in two ways:

- From the **Plugins** panel, which lists every Plugin and its actions.
- From the right-click menu of an area, a place, or a point, when the Plugin
  offers its action there. For example: "Find buildings here".

The operator fills the inputs with **Pick on map**, by picking a place, or by
typing, then presses **Run**. A Plugin moves nothing, so there is no draft and
no Confirm: the call starts at once. A Plugin that is not online is shown
greyed out with the reason, never hidden, and Core
[refuses a call to it](../../core/docs/api.md#operators-call-actions).

Each call has its own page: the Plugin, the action, its inputs, who called it,
its state, and its result. The **Plugin calls** list shows every call by every
operator, newest first, with who called it and its state:

| State | Meaning |
| --- | --- |
| Waiting | Core accepted the call and the Plugin has not answered. |
| Done | The Plugin answered with a result. |
| Failed | The Plugin answered with a failure and its explanation. |
| Not finished | The Plugin went offline or was removed first. What it already stored stays. |

The operator who made a call gets a small notice when it ends. Other operators
are not interrupted. There is no stop and no repeat: an operator who wants
fresh data runs the action again.

## Results

A call's result shows on its page:

- **Listed items**, such as the buildings in an area, show as a list. Items
  with a position can show on the map as a result overlay that only that
  operator sees, and that never enters the shared picture. Each item has
  **Save as place**, which saves it as an ordinary place made by that operator.
- **Places the Plugin made**, imagery included, appear on everyone's map like other places. Their
  page names the Plugin and links to the call.
- **Objects the Plugin stored** appear in the Objects list and on the page of
  the place they are attached to, naming the Plugin and the call.

A failure shows its explanation and whatever the Plugin had already stored.

## Objects

An Object is a file Core holds, such as a photo.

- **On a place's page**, its attached Objects are listed. Photos show inline,
  PDFs open in the browser, and other files download.
- **The Objects list** shows every Object, with a filter for unattached ones.
- **Upload** by dropping a file on a place's page, which attaches it there, or
  on the Objects list. The interface says when a file is over Core's size limit.
- **Move** by picking another place, or **Detach**. **Delete** asks for
  confirmation. A deleted Object disappears from every list and page for the
  rest of the run; the run's Reset ZIP keeps it, marked deleted
  ([Objects](../../core/docs/api.md#objects)).
- **A file shown as imagery cannot be deleted.** Its Delete button says "This
  file is shown on the map as imagery *North field photo*. Delete that imagery
  first," with a link to the imagery's page. If Core refuses the delete with
  `409` anyway, the interface shows the same message.
- **Add imagery** from a GeoTIFF Object's page, or upload a GeoTIFF as imagery
  ([Draw places](README.md#draw-places)).
- An Object has no position of its own, so it shows on the map only through its
  place.

An Object's page shows its name, type, size, who stored it, the place it is
attached to, any imagery that shows it, and a preview or download. A deleted Object's page says it was
deleted, by whom, and when, from Core's
[`410 deleted` answer](../../core/docs/api.md#objects).

A file an Asset uploaded, such as a drone photo, appears like any other Object,
with the Asset as who stored it. It is attached to the place the Asset created
for it, so it shows on the map through that place.
