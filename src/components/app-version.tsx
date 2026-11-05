import { version } from "../../package.json";

export function AppVersion() {
  return <small className="app-version">Version {version}</small>;
}
