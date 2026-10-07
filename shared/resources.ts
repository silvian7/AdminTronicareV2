import generated from "./contracts.generated.json" with { type: "json" };

export type Service =
  | "users"
  | "organizations"
  | "assets"
  | "core"
  | "rules"
  | "actions"
  | "email"
  | "sms"
  | "push"
  | "mqtt"
  | "mqttbridge";
export type Operation = "list" | "show" | "create" | "edit" | "delete";
export type AssetAssignmentKind = "users" | "usergroups";
export const assetAssignmentRoutes: Record<
  AssetAssignmentKind,
  { add: string; remove: string }
> = generated.assetAssignments;
export type RecordData = Record<string, unknown> & { id?: string };
export interface Field {
  key: string;
  type: string;
  nullable: boolean;
  description?: string;
  maxLength?: number;
  minimum?: string;
  maximum?: string;
  enum?: (string | number | boolean)[];
  pattern?: string;
  format?: string;
  required?: boolean;
}
export interface Resource {
  name: string;
  label: string;
  singular: string;
  group: string;
  service: Service;
  primaryKey: string;
  routes: Partial<Record<Operation, string>>;
  fields: Field[];
  createFields: Field[];
  updateFields: Field[];
  query: Field[];
  description: string;
}
const labels: Record<string, [string, string, string]> = {
  organizations: ["Organizations", "Organization", "People & assets"],
  users: ["Users", "User", "People & assets"],
  usergroups: ["User groups", "User group", "People & assets"],
  assets: ["Assets", "Asset", "People & assets"],
  hubs: ["Hubs", "Hub", "Equipment"],
  devices: ["Devices", "Device", "Equipment"],
  sensors: ["Sensors", "Sensor", "Equipment"],
  rules: ["Rules", "Rule", "Automation"],
  actions: ["Actions", "Action", "Automation"],
  rulesforward: ["Rule history", "Rule event", "Activity"],
  actionsforward: ["Action history", "Action event", "Activity"],
  userlog: ["User activity", "User activity", "Activity"],
  organizationstypes: [
    "Organization types",
    "Organization type",
    "Configuration",
  ],
  assettypes: ["Asset types", "Asset type", "Configuration"],
  hubtypes: ["Hub types", "Hub type", "Configuration"],
  devicetypes: ["Device types", "Device type", "Configuration"],
  sensortypes: ["Sensor types", "Sensor type", "Configuration"],
  ruletypes: ["Rule types", "Rule type", "Configuration"],
  actiontypes: ["Action types", "Action type", "Configuration"],
  usertypes: ["User types", "User type", "Access"],
  authz: ["Permissions", "Permission", "Access"],
  entities: ["Permission resources", "Permission resource", "Access"],
};
export const resources: Resource[] = Object.entries(generated.resources).map(
  ([name, contract]) => ({
    ...contract,
    name,
    label: labels[name][0],
    singular: labels[name][1],
    group: labels[name][2],
  }),
) as Resource[];
export const resourceMap = Object.fromEntries(
  resources.map((r) => [r.name, r]),
);
export const services: Service[] = [
  "users",
  "organizations",
  "assets",
  "core",
  "rules",
  "actions",
  "email",
  "sms",
  "push",
  "mqtt",
  "mqttbridge",
];
export const serviceLabels: Record<Service, string> = {
  users: "Users",
  organizations: "Organizations",
  assets: "Assets",
  core: "Equipment",
  rules: "Rules",
  actions: "Actions",
  email: "Email",
  sms: "SMS",
  push: "Push notifications",
  mqtt: "MQTT",
  mqttbridge: "MQTT bridge",
};
export const canonical = (key: string) =>
  key.replace(/^m_(?:dh|du|mo|n|s|b|d|h|r)/, "");
export const hiddenField = (key: string) =>
  /^(Token|Hash|Code|CodeExpired|CodeUsed|ThingKey|MqttPassword)$/i.test(
    canonical(key),
  );
export const referenceResource: Record<string, string> = {
  IDOrganization: "organizations",
  IDOrganizationType: "organizationstypes",
  IDUserType: "usertypes",
  IDuser: "users",
  IDusergroup: "usergroups",
  IDAsset: "assets",
  IDAssetType: "assettypes",
  IDHub: "hubs",
  IDHubType: "hubtypes",
  IDDevice: "devices",
  IDDeviceType: "devicetypes",
  IDSensor: "sensors",
  IDSensorType: "sensortypes",
  IDRule: "rules",
  IDRuleType: "ruletypes",
  IDAction: "actions",
  IDActionType: "actiontypes",
  IDentity: "entities",
};
const fieldLabels: Record<string, string> = {
  IDOrganization: "Organization",
  IDOrganizationType: "Organization type",
  IDuser: "User",
  IDUserType: "User type",
  IDusergroup: "User group",
  IDAsset: "Asset",
  IDAssetType: "Asset type",
  IDHub: "Hub",
  IDHubType: "Hub type",
  IDDevice: "Device",
  IDDeviceType: "Device type",
  IDSensor: "Sensor",
  IDSensorType: "Sensor type",
  IDRule: "Rule",
  IDRuleType: "Rule type",
  IDAction: "Action",
  IDActionType: "Action type",
  IDentity: "Resource",
  ValueDuree: "Duration (milliseconds)",
  ValueThreshold: "Threshold",
  TimeStart: "Start time (UTC)",
  TimeEnd: "End time (UTC)",
  Time24h: "All day",
  DtPauseRulesStart: "Pause from",
  DtPauseRulesEnd: "Pause until",
  DhLastEvent: "Last event",
  First_name: "First name",
  Last_name: "Last name",
  Rights: "Allowed operations",
  NuméroInterneClient: "Customer number",
  Société: "Company",
  Civilité: "Salutation",
  Prénom: "First name",
  Prénom2: "Middle name",
  Adresse: "Address",
  AdresseSuite: "Address line 2",
  CodePostal: "Postal code",
  Ville: "City",
  EtatDep: "State / region",
  Pays: "Country",
  Téléphone: "Phone",
  NumTVA: "VAT number",
  Banque: "Bank",
  EnCoursAutorisé: "Credit limit",
  ExemptTVA: "VAT exempt",
  LivrerMêmeAdresse: "Same delivery address",
  FacturerMêmeAdresse: "Same billing address",
  DateNaissance: "Date of birth",
  ARappeler: "Call back",
  AdresseIP: "IP address",
  Observations: "Notes",
  SaisiPar: "Created by",
  SaisiLe: "Created on",
  ModifiéPar: "Modified by",
  ModifiéLe: "Modified on",
  NomUtilisateur: "Username",
  SerialNr: "Serial number",
  SerialCode: "Serial code",
};
export function fieldLabel(key: string): string {
  const name = canonical(key);
  return (
    fieldLabels[name] ??
    name
      .replace(/^Dh/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
  );
}
export function translated(value: unknown, language = "en"): string {
  if (typeof value !== "string") return value == null ? "" : String(value);
  try {
    const json = JSON.parse(value);
    if (Array.isArray(json.messages))
      return (
        json.messages.find(
          (m: { lang: string }) => m.lang?.toLowerCase() === language,
        )?.text ??
        json.messages[0]?.text ??
        value
      );
  } catch {
    /* Plain legacy text is valid. */
  }
  return value;
}
export const recordTitle = (r: RecordData) =>
  translated(
    r.m_sLabel ||
      r.Label ||
      r.m_sTag ||
      r.Tag ||
      r.m_sLogin ||
      r.m_sSerialNr ||
      r.SerialNr ||
      r.id ||
      "Untitled",
  );
export const valueOf = (r: RecordData, name: string) =>
  r[name] ?? Object.entries(r).find(([key]) => canonical(key) === name)?.[1];
export function editableFields(
  resource: Resource,
  mode: "create" | "edit",
): Field[] {
  const fields =
    mode === "create" ? resource.createFields : resource.updateFields;
  return fields.filter((f) => {
    if (f.key === resource.primaryKey || hiddenField(f.key)) return false;
    if (resource.service === "core" && !/^[A-Z]/.test(f.key)) return false; // One canonical spelling per alias family.
    const name = canonical(f.key);
    if (
      /^(Dh|Created|Modified|Saisi|Modifié|LastLogin|LastLogout|OldLogin|Connected|AssetTag)/.test(
        name,
      )
    )
      return false;
    if (
      /^(Timeout|Canceled|Output|Processed|Result|ForwardTries|ForwardFailed|Tries|Failed)/.test(
        name,
      )
    )
      return false;
    if (resource.name === "userlog" || resource.name === "entities")
      return false;
    if (resource.name.endsWith("forward"))
      return ["IsRead", "IsAck", "IsArchive", "IsDeleted"].includes(name);
    return true;
  });
}
export function responseKey(resource: Resource, writeKey: string): string {
  return (
    resource.fields.find((f) => canonical(f.key) === canonical(writeKey))
      ?.key ?? writeKey
  );
}
export const isReadOnly = (r: Resource) =>
  r.name === "userlog" || r.name === "entities";

export interface Identity {
  id: string;
  name: string;
  organizationId: string;
  userTypeId: string;
  level: number;
  permissions: { entity: string; rights: string }[];
  mustChangePassword: boolean;
}
export function canAccess(
  identity: Identity,
  name: string,
  operation: Operation,
): boolean {
  const r = resourceMap[name];
  if (!r?.routes[operation]) return false;
  const read = operation === "list" || operation === "show";
  if (
    !read &&
    (isReadOnly(r) || (r.name.endsWith("forward") && operation !== "edit"))
  )
    return false;
  if (identity.mustChangePassword && !read) return false;
  if (identity.level >= 90) return true;
  if (!read && ["authz", "usertypes"].includes(name)) return false;
  if (read && ["usertypes", "usergroups", "entities", "authz"].includes(name))
    return true;
  const right = { list: "r", show: "r", create: "c", edit: "u", delete: "d" }[
    operation
  ];
  return identity.permissions.some(
    (p) =>
      p.entity.toLowerCase() === name && p.rights.toLowerCase().includes(right),
  );
}
