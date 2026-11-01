# The Atlas charter

Atlas helps operators understand field systems, request work, and retain evidence.

## Keep the product understandable

The owner must be able to read the docs whenever they change.
Use short stories and visible flows.
Consequential restrictions belong in a story before implementation adopts them.

## Scope

Core does not implement vehicle flight control, radio transport, map rendering,
or operator applications. Separate projects provide them.

## Keep the systems replaceable

Entities, Tasks, Objects, and Plugins are four replaceable pillars. Each has a
small interface and private data ownership. Plugin-published information belongs
to Entities and Objects. Invocation metadata needs a selected story. No job
platform is assumed. Authentication and administration support the pillars.
Separate databases and deployments are optional.

## Keep evidence honest

Acceptance is not execution. Requested cancellation is not proof an Asset stopped.
Completion and file availability differ. Receiving a report proves neither fresh
measurements nor two-way contact.

## Document ownership

The precedence for intended behavior is:

1. Central charter and stories: purpose, assumptions, user-visible behavior.
2. Protocol: exact shared messages, fields, and state meanings implementing that behavior.
3. Components: mechanisms and checks implementing those contracts.

Component instructions link here. Resolve conflicting documents explicitly.
Intended behavior is not proof of implementation.

## Change Atlas deliberately

The owner approves behavior and scope; engineers choose conforming details.
Keep selected behavior, proposals, and open questions distinct. Generated output,
reviews, and historical specifications do not approve changes.
