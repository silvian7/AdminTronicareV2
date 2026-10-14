export const outboxServices = [
  "rules",
  "actions",
  "push",
  "email",
  "sms",
  "mqtt",
  "mqttbridge",
] as const;

export type OutboxService = (typeof outboxServices)[number];

export const serviceOutboxLabels: Record<
  OutboxService,
  Record<string, string>
> = {
  rules: { rules_forward: "Rule forwarding" },
  actions: { actions_forward: "Action forwarding" },
  push: { delivery: "Delivery", results: "Results" },
  email: { delivery: "Delivery", results: "Results" },
  sms: { delivery: "Delivery", results: "Results" },
  mqtt: {
    delivery: "Delivery",
    results: "Results",
    sensor_information: "Sensor information",
  },
  mqttbridge: {
    mqtt: "MQTT",
    core_primary: "Core primary",
    core_mirror: "Core mirror",
  },
};

export interface ServiceOutbox {
  destination: string;
  size: string;
  latencySeconds: string;
}

export interface ServiceOutboxStatus {
  service: OutboxService;
  state: "available" | "unavailable" | "unconfigured";
  outboxes: ServiceOutbox[];
  message?: string;
}
