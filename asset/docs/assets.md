# Assets and their equipment

## Intended Assets

One vehicle is one Asset, including its camera and gimbal capabilities. The
Command Interface presents its supported functions together. Protocol's
[`admin.describe`](../../protocol/definitions/messages/admin/describe.json)
already supports cameras and an empty command list within one Asset description.

The first Asset is a generic ArduPilot quadcopter with a companion computer and
radio connection to Atlas, carrying out the [first-flight story](../../atlas/first-flight.md).
Other intended Assets include fixed-wing drones, boats, autonomous ground vehicles,
and stationary pan-and-tilt cameras.

A tracker attached to a car is a reporting-only beacon: it pushes position to Atlas,
accepts no equipment-control commands, and has no failsafe. Its radio may also
participate in the mesh; that role is separate from its Asset capabilities.

## Proposed platform integration

The proposal is a shared Asset app on ordinary Linux, with equipment code and
configuration for each platform. The app uses the Atlas SDK for Atlas messages
and coordinates Tasks, outcome reporting, and local logging. Its platform
integration performs equipment operations and supplies completion evidence.

For the first drone, the companion computer talks to ArduPilot through
[MAVLink](https://ardupilot.org/dev/docs/companion-computers.html); ArduPilot handles
flight control and stabilization. Copter, fixed-wing, and VTOL integrations can
share that connection code while using different preparation procedures.
[Takeoff preparation and arming](README.md#prepare-and-take-off) belongs to the app.

A supported gimbal can be [controlled through ArduPilot](https://ardupilot.org/dev/docs/mavlink-gimbal-mount.html)
or connected directly to the companion computer. The gimbal connection and
camera image path remain open.

Different procedures can fulfill the same command only if they meet the same
requested behavior. First-flight Takeoff climbs straight up and holds altitude;
it does not describe conventional fixed-wing takeoff. Distinct fixed-wing,
vertical, and VTOL takeoff commands remain an option. Their behavior must be
agreed before Protocol defines their names and inputs.

## Decisions still needed

- Power-on behavior before Tasks, including which startup-home rules apply beyond drones.
- How equipment exposes physical arming requirements and confirms completion.
- Interaction between app decisions and the autopilot's own failsafes.
- Packaging, startup management, and the boundary between platform code and configuration.

No Asset runtime is built yet. Exact shared contracts belong to Protocol;
SDK and radio behavior stay in their owning docs.
