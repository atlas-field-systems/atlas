/* Generated from definitions/. Run npm run types to update. */

export type VariablesTime = number;
export type VariablesAssetId = string;
export type VariablesTaskId = number;
export type VariablesRequestedBy = string;
export type RecordsContact = {} & {
  time: VariablesTime;
  asset_id?: VariablesAssetId;
  gateway_id?: VariablesGatewayId;
  plugin_id?: VariablesPluginId;
  contact: VariablesContact;
};
export type VariablesGatewayId = string;
export type VariablesPluginId = string;
export type VariablesContact = "online" | "offline";
export type VariablesObjectId = string;
export type VariablesEntityType =
  | "person"
  | "ground_vehicle"
  | "airplane"
  | "helicopter"
  | "drone"
  | "aircraft"
  | "watercraft"
  | "animal"
  | "structure"
  | "fixed_sensor"
  | "other";
export type VariablesReport = "status" | "failsafe" | "telemetry" | "battery" | "settings" | "observation" | "gimbal";
export type VariablesCommand =
  "takeoff" | "move_to" | "land" | "return_to_home" | "hold" | "point_at" | "failsafe" | "capture";
export type VariablesSetting =
  | "run_state"
  | "lights"
  | "landing_gear"
  | "link_loss_after_s"
  | "failsafe_policy"
  | "home_position"
  | "telemetry_every_s";
export type VariablesSubsystemId = string;
export type VariablesLabel = string;
export type VariablesCameraId = string;
export type VariablesMount = "fixed" | "gimbal";
export type VariablesYawDeg = number;
export type VariablesPitchDeg = number;
export type VariablesRollDeg = number;
export type VariablesFovDeg = number;
export type RecordsDrop = RecordsDrop1 & {
  time: VariablesTime;
  asset_id?: VariablesAssetId;
  task_id?: VariablesTaskId;
  plugin_id?: VariablesPluginId;
  request_id?: VariablesRequestId;
};
export type RecordsDrop1 = {};
export type VariablesRequestId = number;
export type RecordsGeofeature = {
  time: VariablesTime;
  kind: VariablesKind;
  geofeature_id: VariablesGeofeatureId;
  name?: VariablesName;
} & RecordsGeofeature1;
export type VariablesKind = string;
export type VariablesGeofeatureId = string;
export type VariablesName = string;
export type RecordsGeofeature1 =
  RecordsGeofeaturePoint | RecordsGeofeatureLine | RecordsGeofeatureArea | RecordsGeofeatureImagery;
export type VariablesLatitude = number;
export type VariablesLongitude = number;
export type VariablesAltitudeM = number;
export type VariablesAltitudeReference = "msl" | "ellipsoid" | "launch" | "ground";
/**
 * @minItems 2
 * @maxItems 32
 */
export type ComponentsLine = ComponentsPoint[];
/**
 * @minItems 3
 * @maxItems 32
 */
export type ComponentsArea = ComponentsPoint[];
export type VariablesContentType = string;
export type VariablesSizeBytes = number;
export type VariablesAction = string;
export type ComponentsInputValue = {
  kind: VariablesKind;
  input: VariablesInput;
} & ComponentsInputValue1;
export type VariablesInput = string;
export type ComponentsInputValue1 =
  | ComponentsInputValueArea
  | ComponentsInputValuePosition
  | ComponentsInputValueTime
  | ComponentsInputValueGeofeature
  | ComponentsInputValueNumber
  | ComponentsInputValueText
  | ComponentsInputValueChoice;
export type VariablesTargetTime = number;
export type VariablesNumber = number;
export type VariablesText = string;
export type VariablesChoice = string;
export type VariablesHelpText = string;
export type ComponentsPluginInput = {
  input: VariablesInput;
  label: VariablesLabel;
  input_kind: VariablesInputKind;
  optional?: VariablesOptional;
  /**
   * @minItems 1
   * @maxItems 32
   */
  choices?: VariablesChoice[];
};
export type VariablesInputKind = "area" | "position" | "time" | "geofeature" | "number" | "text" | "choice";
export type VariablesOptional = boolean;
export type VariablesInMenu = boolean;
export type VariablesShowOnMap = boolean;
export type VariablesExplanation = string;
export type RequestsGeofeature = {
  kind: VariablesKind;
  name?: VariablesName;
} & RequestsGeofeature1;
export type RequestsGeofeature1 =
  RecordsGeofeaturePoint | RecordsGeofeatureLine | RecordsGeofeatureArea | RecordsGeofeatureImagery;
export type RecordsProvisioning = {} & {
  time: VariablesTime;
  gateway_id?: VariablesGatewayId;
  plugin_id?: VariablesPluginId;
  requested_by: VariablesRequestedBy;
};
export type RecordsRefusal = {} & {
  time: VariablesTime;
  asset_id?: VariablesAssetId;
  gateway_id?: VariablesGatewayId;
  plugin_id?: VariablesPluginId;
  radio?: VariablesRadio;
  definitions_hash: VariablesDefinitionsHash;
};
export type VariablesRadio = boolean;
export type VariablesDefinitionsHash = string;
export type VariablesBatteryPercent = number;
export type RecordsReportFailsafe = {
  type: "report.failsafe";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  kind: VariablesKind;
  explanation?: VariablesExplanation;
} & RecordsReportFailsafe1;
export type RecordsReportFailsafe1 =
  RecordsReportFailsafeResponse | RecordsReportFailsafeOverride | RecordsReportFailsafeAutopilot;
export type VariablesRuleId = string;
export type VariablesTaskState = "queued" | "active" | "completed" | "failed" | "cancelled";
export type ComponentsFailsafeResponse = {
  kind: VariablesKind;
} & ComponentsFailsafeResponse1;
export type ComponentsFailsafeResponse1 =
  | RecordsTaskTakeoff
  | RecordsTaskMoveTo
  | RecordsTaskLand
  | RecordsTaskReturnToHome
  | RecordsTaskHold
  | RecordsTaskPointAt
  | RecordsTaskCapture;
export type RecordsTaskMoveTo = {} & {
  kind: "move_to";
  destination?: ComponentsPosition;
  geofeature_id?: VariablesGeofeatureId;
  ground_speed_mps?: VariablesGroundSpeedMps;
};
export type VariablesGroundSpeedMps = number;
export type RecordsTaskCapture = {
  kind: "capture";
  camera_id: VariablesCameraId;
  media: VariablesMedia;
  duration_s?: VariablesDurationS;
};
export type VariablesMedia = "photo" | "clip";
export type VariablesDurationS = number;
export type VariablesInControl = boolean;
export type RecordsReportObservation = {
  type: "report.observation";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  kind: VariablesKind;
  observation_id: VariablesObservationId;
  entity_type?: VariablesEntityType;
  details?: ComponentsDetails;
} & RecordsReportObservation1;
export type VariablesObservationId = string;
export type VariablesIcaoAddress = string;
export type VariablesCallsign = string;
export type VariablesSquawk = string;
export type VariablesColor =
  "black" | "white" | "gray" | "silver" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "brown";
export type RecordsReportObservation1 = RecordsReportObservationCoordinates | RecordsReportObservationBearing;
export type VariablesSemiMajorM = number;
export type VariablesSemiMinorM = number;
export type VariablesOrientationDeg = number;
export type VariablesAltitudeUncertaintyM = number;
export type VariablesBearingDeg = number;
export type VariablesBearingUncertaintyDeg = number;
export type VariablesElevationDeg = number;
export type VariablesElevationUncertaintyDeg = number;
export type VariablesRangeM = number;
export type VariablesRangeUncertaintyM = number;
export type VariablesRunState = "paused" | "running";
export type VariablesLights = "on" | "off";
export type VariablesLandingGear = "up" | "down";
export type VariablesLinkLossAfterS = number;
export type VariablesPriority = number;
export type ComponentsFailsafeCondition = {
  kind: VariablesKind;
} & ComponentsFailsafeCondition1;
export type ComponentsFailsafeCondition1 =
  | ComponentsFailsafeConditionContactLost
  | ComponentsFailsafeConditionBatteryBelow
  | ComponentsFailsafeConditionIdle
  | ComponentsFailsafeConditionAirborne
  | ComponentsFailsafeConditionOutsideArea
  | ComponentsFailsafeConditionSubsystem
  | ComponentsFailsafeConditionCommanded;
export type VariablesCritical = boolean;
export type VariablesForS = number;
export type VariablesMarginM = number;
export type VariablesTelemetryEveryS = number;
export type RecordsReportStatus = {
  type: "report.status";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  kind: VariablesKind;
} & RecordsReportStatus1;
export type RecordsReportStatus1 = RecordsReportStatusSubsystem | RecordsReportStatusTask | RecordsReportStatusQueue;
export type VariablesCondition = "unknown" | "healthy" | "degraded" | "faulted";
export type RecordsReportStatusTask = {
  kind: "task";
  task_id: VariablesTaskId;
  task_state: VariablesTaskState;
  explanation?: VariablesExplanation;
  request_id?: VariablesRequestId;
  /**
   * @minItems 1
   * @maxItems 16
   */
  object_ids?: VariablesObjectId[];
};
export type VariablesHeadingDeg = number;
export type VariablesOperatorId = string;
export type VariablesPassword = string;
export type VariablesAdmin = boolean;
export type VariablesAttachment = VariablesGeofeatureId | null;
export type VariablesAssetReport =
  | RecordsReportStatus
  | RecordsReportFailsafe
  | RecordsReportTelemetry
  | RecordsReportBattery
  | RecordsReportGimbal
  | RecordsReportSettings
  | RecordsReportObservation;
export type RequestsTask = {
  kind: VariablesKind;
} & RequestsTask1;
export type RequestsTask1 =
  | RecordsTaskTakeoff
  | RecordsTaskMoveTo
  | RecordsTaskLand
  | RecordsTaskReturnToHome
  | RecordsTaskHold
  | RecordsTaskPointAt
  | RecordsTaskFailsafe
  | RecordsTaskSettings
  | RecordsTaskCapture;
export type RequestsTasks = {
  /**
   * @minItems 1
   * @maxItems 64
   */
  tasks: RequestsTask[];
  now?: VariablesNow;
};
export type VariablesNow = boolean;
export type RecordsTask = {
  time: VariablesTime;
  asset_id: VariablesAssetId;
  task_id: VariablesTaskId;
  send_last?: VariablesSendLast;
  now?: VariablesNow;
  requested_by: VariablesRequestedBy;
  kind: VariablesKind;
} & RecordsTask1;
export type VariablesSendLast = number;
export type RecordsTask1 =
  | RecordsTaskTakeoff
  | RecordsTaskMoveTo
  | RecordsTaskLand
  | RecordsTaskReturnToHome
  | RecordsTaskHold
  | RecordsTaskPointAt
  | RecordsTaskFailsafe
  | RecordsTaskSettings
  | RecordsTaskCapture;
export type VariablesTrackId = string;

export interface ProtocolTypes {
  cancel: RecordsCancel;
  contact: RecordsContact;
  deletion: RecordsDeletion;
  description: RecordsDescription;
  drop: RecordsDrop;
  geofeature: RecordsGeofeature;
  object: RecordsObject;
  "plugin.call": RecordsPluginCall;
  "plugin.description": RecordsPluginDescription;
  "plugin.failure": RecordsPluginFailure;
  "plugin.result": RecordsPluginResult;
  provisioning: RecordsProvisioning;
  refusal: RecordsRefusal;
  registration: RecordsRegistration;
  "report.battery": RecordsReportBattery;
  "report.failsafe": RecordsReportFailsafe;
  "report.gimbal": RecordsReportGimbal;
  "report.observation": RecordsReportObservation;
  "report.settings": RecordsReportSettings;
  "report.status": RecordsReportStatus;
  "report.telemetry": RecordsReportTelemetry;
  "requests.account": RequestsAccount;
  "requests.asset": RequestsAsset;
  "requests.attach": RequestsAttach;
  "requests.geofeature": RequestsGeofeature;
  "requests.login": RequestsLogin;
  "requests.plugin_call": RequestsPluginCall;
  "requests.radio": RequestsRadio;
  "requests.reports": RequestsReports;
  "requests.settings": RequestsSettings;
  "requests.task": RequestsTask;
  "requests.tasks": RequestsTasks;
  settings_change: RecordsSettingsChange;
  task: RecordsTask;
  track: RecordsTrack;
}
export interface RecordsCancel {
  time: VariablesTime;
  asset_id: VariablesAssetId;
  task_id: VariablesTaskId;
  requested_by: VariablesRequestedBy;
}
export interface RecordsDeletion {
  time: VariablesTime;
  object_id: VariablesObjectId;
  requested_by: VariablesRequestedBy;
}
export interface RecordsDescription {
  time: VariablesTime;
  asset_id: VariablesAssetId;
  entity_type?: VariablesEntityType;
  /**
   * @minItems 1
   * @maxItems 7
   */
  reports: VariablesReport[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  commands: VariablesCommand[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  settings?: VariablesSetting[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  subsystems?: ComponentsSubsystem[];
  /**
   * @minItems 1
   * @maxItems 4
   */
  cameras?: ComponentsCamera[];
}
export interface ComponentsSubsystem {
  subsystem_id: VariablesSubsystemId;
  label: VariablesLabel;
}
export interface ComponentsCamera {
  camera_id: VariablesCameraId;
  mount: VariablesMount;
  yaw_deg: VariablesYawDeg;
  pitch_deg: VariablesPitchDeg;
  roll_deg?: VariablesRollDeg;
  horizontal_fov_deg: VariablesFovDeg;
  vertical_fov_deg: VariablesFovDeg;
}
export interface RecordsGeofeaturePoint {
  kind: "point";
  position: ComponentsPosition;
}
export interface ComponentsPosition {
  latitude: VariablesLatitude;
  longitude: VariablesLongitude;
  /**
   * @minItems 1
   * @maxItems 4
   */
  altitudes?: ComponentsAltitude[];
}
export interface ComponentsAltitude {
  altitude_m: VariablesAltitudeM;
  altitude_reference: VariablesAltitudeReference;
}
export interface RecordsGeofeatureLine {
  kind: "line";
  line: ComponentsLine;
}
export interface ComponentsPoint {
  latitude: VariablesLatitude;
  longitude: VariablesLongitude;
}
export interface RecordsGeofeatureArea {
  kind: "area";
  area: ComponentsArea;
}
export interface RecordsGeofeatureImagery {
  kind: "imagery";
  object_id: VariablesObjectId;
}
export interface RecordsObject {
  time: VariablesTime;
  object_id: VariablesObjectId;
  name: VariablesName;
  content_type: VariablesContentType;
  size_bytes: VariablesSizeBytes;
  geofeature_id?: VariablesGeofeatureId;
  requested_by: VariablesRequestedBy;
}
export interface RecordsPluginCall {
  type: "plugin.call";
  time: VariablesTime;
  plugin_id: VariablesPluginId;
  action: VariablesAction;
  /**
   * @maxItems 16
   */
  inputs: ComponentsInputValue[];
  requested_by: VariablesRequestedBy;
}
export interface ComponentsInputValueArea {
  kind: "area";
  area: ComponentsArea;
}
export interface ComponentsInputValuePosition {
  kind: "position";
  position: ComponentsPosition;
}
export interface ComponentsInputValueTime {
  kind: "time";
  target_time: VariablesTargetTime;
}
export interface ComponentsInputValueGeofeature {
  kind: "geofeature";
  geofeature_id: VariablesGeofeatureId;
}
export interface ComponentsInputValueNumber {
  kind: "number";
  number: VariablesNumber;
}
export interface ComponentsInputValueText {
  kind: "text";
  text: VariablesText;
}
export interface ComponentsInputValueChoice {
  kind: "choice";
  choice: VariablesChoice;
}
export interface RecordsPluginDescription {
  type: "plugin.description";
  time: VariablesTime;
  plugin_id: VariablesPluginId;
  name: VariablesName;
  /**
   * @minItems 1
   * @maxItems 16
   */
  actions: ComponentsPluginAction[];
}
export interface ComponentsPluginAction {
  action: VariablesAction;
  label: VariablesLabel;
  help_text?: VariablesHelpText;
  /**
   * @maxItems 16
   */
  inputs: ComponentsPluginInput[];
  in_menu?: VariablesInMenu;
  show_on_map?: VariablesShowOnMap;
}
export interface RecordsPluginFailure {
  type: "plugin.failure";
  time: VariablesTime;
  plugin_id: VariablesPluginId;
  request_id: VariablesRequestId;
  explanation: VariablesExplanation;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  geofeature_ids?: VariablesGeofeatureId[];
  /**
   * @minItems 1
   * @maxItems 1000
   */
  object_ids?: VariablesObjectId[];
}
export interface RecordsPluginResult {
  type: "plugin.result";
  time: VariablesTime;
  plugin_id: VariablesPluginId;
  request_id: VariablesRequestId;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  places?: RequestsGeofeature[];
  /**
   * @minItems 1
   * @maxItems 1000
   */
  facts?: ComponentsFact[];
  /**
   * @minItems 1
   * @maxItems 1000
   */
  geofeature_ids?: VariablesGeofeatureId[];
  /**
   * @minItems 1
   * @maxItems 1000
   */
  object_ids?: VariablesObjectId[];
}
export interface ComponentsFact {
  label: VariablesLabel;
  text: VariablesText;
}
export interface RecordsRegistration {
  time: VariablesTime;
  asset_id: VariablesAssetId;
  requested_by?: VariablesRequestedBy;
}
export interface RecordsReportBattery {
  type: "report.battery";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  battery_percent: VariablesBatteryPercent;
}
export interface RecordsReportFailsafeResponse {
  kind: "response";
  rule_id?: VariablesRuleId;
  task_state: VariablesTaskState;
  response?: ComponentsFailsafeResponse;
}
export interface RecordsTaskTakeoff {
  kind: "takeoff";
  target_altitude: ComponentsAltitude;
}
export interface RecordsTaskLand {
  kind: "land";
  landing_position?: ComponentsPosition;
  geofeature_id?: VariablesGeofeatureId;
  transit_altitude?: ComponentsAltitude;
}
export interface RecordsTaskReturnToHome {
  kind: "return_to_home";
  transit_altitude?: ComponentsAltitude;
}
export interface RecordsTaskHold {
  kind: "hold";
}
export interface RecordsTaskPointAt {
  kind: "point_at";
  target: ComponentsPosition;
}
export interface RecordsReportFailsafeOverride {
  kind: "override";
  request_id: VariablesRequestId;
}
export interface RecordsReportFailsafeAutopilot {
  kind: "autopilot";
  in_control: VariablesInControl;
}
export interface RecordsReportGimbal {
  type: "report.gimbal";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  camera_id: VariablesCameraId;
  yaw_deg: VariablesYawDeg;
  pitch_deg: VariablesPitchDeg;
}
export interface ComponentsDetails {
  icao_address?: VariablesIcaoAddress;
  callsign?: VariablesCallsign;
  squawk?: VariablesSquawk;
  color?: VariablesColor;
}
export interface RecordsReportObservationCoordinates {
  kind: "coordinates";
  position: ComponentsPosition;
  uncertainty?: ComponentsUncertainty;
}
export interface ComponentsUncertainty {
  semi_major_m?: VariablesSemiMajorM;
  semi_minor_m?: VariablesSemiMinorM;
  orientation_deg?: VariablesOrientationDeg;
  polygon?: ComponentsArea;
  altitude_uncertainty_m?: VariablesAltitudeUncertaintyM;
}
export interface RecordsReportObservationBearing {
  kind: "bearing";
  origin: ComponentsPosition;
  bearing_deg: VariablesBearingDeg;
  bearing_uncertainty_deg?: VariablesBearingUncertaintyDeg;
  elevation_deg?: VariablesElevationDeg;
  elevation_uncertainty_deg?: VariablesElevationUncertaintyDeg;
  range_m?: VariablesRangeM;
  range_uncertainty_m?: VariablesRangeUncertaintyM;
}
export interface RecordsReportSettings {
  type: "report.settings";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  request_id?: VariablesRequestId;
  settings: ComponentsSettings;
}
export interface ComponentsSettings {
  run_state?: VariablesRunState;
  lights?: VariablesLights;
  landing_gear?: VariablesLandingGear;
  link_loss_after_s?: VariablesLinkLossAfterS;
  /**
   * @minItems 0
   * @maxItems 16
   */
  failsafe_policy?: ComponentsFailsafeRule[];
  home_position?: ComponentsPosition;
  telemetry_every_s?: VariablesTelemetryEveryS;
}
export interface ComponentsFailsafeRule {
  rule_id: VariablesRuleId;
  priority: VariablesPriority;
  /**
   * @minItems 1
   * @maxItems 8
   */
  conditions: ComponentsFailsafeCondition[];
  response: ComponentsFailsafeResponse;
}
export interface ComponentsFailsafeConditionContactLost {
  kind: "contact_lost";
}
export interface ComponentsFailsafeConditionBatteryBelow {
  kind: "battery_below";
  battery_percent: VariablesBatteryPercent;
  critical?: VariablesCritical;
}
export interface ComponentsFailsafeConditionIdle {
  kind: "idle";
  for_s: VariablesForS;
}
export interface ComponentsFailsafeConditionAirborne {
  kind: "airborne";
}
export interface ComponentsFailsafeConditionOutsideArea {
  kind: "outside_area";
  area: ComponentsArea;
  margin_m?: VariablesMarginM;
  for_s?: VariablesForS;
  max_altitude?: ComponentsAltitude;
  min_altitude?: ComponentsAltitude;
}
export interface ComponentsFailsafeConditionSubsystem {
  kind: "subsystem";
  subsystem_id: VariablesSubsystemId;
  trigger_condition: "degraded" | "faulted";
}
export interface ComponentsFailsafeConditionCommanded {
  kind: "commanded";
}
export interface RecordsReportStatusSubsystem {
  kind: "subsystem";
  subsystem_id: VariablesSubsystemId;
  condition: VariablesCondition;
  explanation?: VariablesExplanation;
}
export interface RecordsReportStatusQueue {
  kind: "queue";
  /**
   * @maxItems 64
   */
  task_ids: VariablesTaskId[];
  request_id?: VariablesRequestId;
}
export interface RecordsReportTelemetry {
  type: "report.telemetry";
  time: VariablesTime;
  asset_id: VariablesAssetId;
  position: ComponentsPosition;
  ground_speed_mps?: VariablesGroundSpeedMps;
  heading_deg?: VariablesHeadingDeg;
}
export interface RequestsAccount {
  operator_id: VariablesOperatorId;
  password: VariablesPassword;
  admin: VariablesAdmin;
}
export interface RequestsAsset {
  entity_type?: VariablesEntityType;
  /**
   * @minItems 1
   * @maxItems 7
   */
  reports: VariablesReport[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  commands: VariablesCommand[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  settings?: VariablesSetting[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  subsystems?: ComponentsSubsystem[];
  /**
   * @minItems 1
   * @maxItems 4
   */
  cameras?: ComponentsCamera[];
}
export interface RequestsAttach {
  geofeature_id: VariablesAttachment;
}
export interface RequestsLogin {
  operator_id: VariablesOperatorId;
  password: VariablesPassword;
}
export interface RequestsPluginCall {
  /**
   * @maxItems 16
   */
  inputs: ComponentsInputValue[];
}
export interface RequestsRadio {
  definitions_hash: VariablesDefinitionsHash;
}
export interface RequestsReports {
  /**
   * @minItems 0
   * @maxItems 1000
   */
  reports: VariablesAssetReport[];
}
export interface RequestsSettings {
  settings: ComponentsSettings;
}
export interface RecordsTaskFailsafe {
  kind: "failsafe";
}
export interface RecordsTaskSettings {
  kind: "settings";
  settings: ComponentsSettings;
}
export interface RecordsSettingsChange {
  time: VariablesTime;
  asset_id: VariablesAssetId;
  requested_by: VariablesRequestedBy;
  settings: ComponentsSettings;
}
export interface RecordsTrack {
  time: VariablesTime;
  track_id: VariablesTrackId;
  entity_type?: VariablesEntityType;
  position?: ComponentsPosition;
  uncertainty?: ComponentsUncertainty;
  details?: ComponentsDetails;
  /**
   * @minItems 1
   * @maxItems 32
   */
  sources: ComponentsSource[];
}
export interface ComponentsSource {
  asset_id: VariablesAssetId;
  observation_id: VariablesObservationId;
}
