# The goal

Who Atlas is for, the problem it solves, what it does and does not do, and how
to tell it works. [ADR-0001](https://github.com/atlas-field-systems/atlas/blob/main/docs/adr/0001-atlas-is-an-experiment-platform-for-one-field-tester.md)
records the decision.

## Who it is for

Atlas is for one person in a field, testing drones and sensors. Today that
person is the owner. Usually one operator controls several Assets. Sometimes
there is more than one operator.

One Core may run several gateways at once, as long as their radio links
cannot clash ([Scale](scale.md#setup)).

Atlas is a platform for experiments. It is not yet a product that has to work
every time. The owner will say when that changes.

## The problem

One person needs to see the Observations from several Assets in one shared
picture, and to send work to another Asset from that picture.

A ground-control station such as QGroundControl is made for one drone. A radio
plugs into a laptop, the laptop shows the drone, and the operator tells the
drone to fly here and then there. The station does not give the drone richer
work, and it does not bring back the data the owner wants: Observations,
Tracks, places, and a picture fused from several Assets.

## What Atlas does

1. It receives data from each Asset about the Asset itself.
2. It receives the Observations that each Asset makes.
3. It sends commands to Assets.

Sending data, receiving data, and tasking Assets are the whole point. Every
other part of Atlas exists to serve those three.

## What Atlas is not

- **Not a joystick.** Nobody flies a drone by hand through Atlas. The links
  Atlas supports cannot carry hand control. The operator sends Tasks and the
  Asset carries them out.
- **Not a flight controller.** The Asset app decides motion and the autopilot
  flies ([Charter](CHARTER.md#keep-judgment-sharp)).
- **Not a radio.** Atlas rides on existing radios through
  [Fieldlinks](https://github.com/atlas-field-systems/atlas/blob/main/fieldlink/README.md).
- **Not a swarm brain.** Assets do not plan among themselves. The operator
  tasks each one.
- **Not usable without Core.** While Core is unreachable, nobody can send new
  work ([Environment](environment.md#core-is-a-deliberate-dependency)).
- **Not for separate teams.** Everything connected to Atlas is trusted and sees
  everything, whether an operator or an Asset.
- **Not a phone app for people in the field.** The screen is for someone at a
  command station, which may be a laptop with no internet
  ([Command Interface](https://github.com/atlas-field-systems/atlas/blob/main/command-interface/docs/README.md#operators-and-connectivity)).
- **Not for every vehicle.** Quadcopters come first. Other vehicles come later,
  each as its own kind of Asset.
- **Not a mission planner.** Work is single Tasks, with no multi-step Plans
  ([ADR-0015](https://github.com/atlas-field-systems/atlas/blob/main/docs/adr/0015-work-is-individual-tasks-there-are-no-plans.md)).
- **Not a long-term archive.** Core's data leaves Core at
  [Reset](reset-and-identity.md#the-picture-and-reset).
- **Not dependable yet.** Atlas is for experiments and makes no promise to
  work every time.

## Kept in mind for later

Ideas the owner wants one day are in the [drawer](https://github.com/atlas-field-systems/atlas/blob/main/docs/drawer/README.md).
Today's work must not rule out the ones marked Keep room, and must not grow to
make room for them.

## How we know it works

In-depth simulations of whole operations show that Atlas works, together with
tools that make a new simulation quick to write. For now simulations are the
whole answer. Proof from real flights comes later.
[Simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/README.md)
owns how they run.

The target is a simulation running the real code of every part: the real
Asset app, Core, gateway app, and Fieldlinks. No real hardware takes part.
Only the equipment and the links between the parts are simulated, such as a
simulated radio link.

That full simulation covers a whole operation and its failures:

- Assets take off and make Observations.
- Other Assets are tasked onto those Observations.
- Fusion makes Tracks, and other Assets are tasked onto those Tracks.
- A radio link fails, and an Asset flies out of range.
- Hardware faults.

The existing simulations run Protocol, Core, the SDK, and the initial Asset
app over IP in CI. [Simulations](https://github.com/atlas-field-systems/atlas/blob/main/simulations/README.md) owns the current
coverage and the callers that remain scripted.

The full operation above still awaits the gateway app and Fieldlinks. The
[build order](build-order.md) says what remains to build.

## The test question

Hold every new idea against one question: is this overcomplicated?

Atlas aims for systems that are simple and elegant. Complexity for its own
sake is not worth having. When a hard problem needs complexity, look for the
simpler solution first ([Proven and lean](CHARTER.md#keep-designs-proven-and-lean)).
