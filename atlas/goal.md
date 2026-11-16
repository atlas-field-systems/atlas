# The goal

Who Atlas is for, the problem it solves, what it does and does not do, and how
to tell it works. The [decision log](decision-log.md#the-goal) dates each
decision.

## Who it is for

Atlas is for one person in a field, testing drones and sensors. Today that
person is the owner. Usually one operator controls several Assets. Sometimes
there is more than one operator.

One Core may run several gateways at once, as long as their radio links
cannot clash ([Scale](scale.md#setup)).

Atlas is a platform for experiments. It is not yet a product that has to work
every time. The owner will say when that changes.

## The problem

No open-source software does this. The software that does is built for
militaries.

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
  command station with internet
  ([Command Interface](https://github.com/atlas-field-systems/atlas/blob/main/command-interface/docs/README.md#operators-and-connectivity)).
- **Not for every vehicle.** Quadcopters come first. Other vehicles come later,
  each as its own kind of Asset.
- **Not a mission planner.** Work is single Tasks, with no multi-step Plans
  ([Design decisions](design-decisions.md#work-is-always-a-task)).
- **Not a long-term archive.** A run's data leaves Core at
  [Reset](runs-and-identity.md#a-run-and-reset).
- **Not dependable yet.** Atlas is for experiments and makes no promise to
  work every time.

## Kept in mind for later

The owner wants each of these one day. None is designed or built now. Today's
work must not rule them out, and must not grow to make room for them.

- **Live video.** A video feed is an Object, and it plays only while someone
  has it open. An example is a 5.8 GHz video receiver plugged into a gateway.
  The operator links the feed to an Asset by hand, and then watches it on that
  Asset's page.
- **FPV drones.** A gateway that flies standard FPV drones with MAVLink over
  ordinary drone radios, and brings back their video.
- **Following a Track.** Today a command names a position, so an operator can
  send an Asset to where a Track is now. Later a command will make an Asset
  keep following a Track.
- **Drops.** An Asset drops a package, such as first aid or supplies.
- **Listening in.** On a mesh radio link every radio hears the others. An
  Asset keeps what it hears as its own local picture of the Assets,
  Observations, and Tracks around it, at no cost in air time. An Asset told
  to follow another Asset then listens to it and does not ask Core
  ([Experimental ideas](experimental.md#passive-listening)).

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
simpler solution first ([Proven and lean](design-decisions.md#proven-and-lean)).
