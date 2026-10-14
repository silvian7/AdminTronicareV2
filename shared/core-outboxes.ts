export const coreOutboxLabels = {
  rules: "Rules",
  assets: "Assets",
  mqtt_information: "MQTT information",
  external_history: "External history",
} as const;

export interface CoreOutbox {
  destination: keyof typeof coreOutboxLabels;
  size: string;
  latencySeconds: string;
}
