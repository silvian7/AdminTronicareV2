import { createContext, useContext, useState, type ReactNode } from "react";
import type { Identity, Resource, Operation } from "../shared/resources";
import { canAccess } from "../shared/resources";
import { getSession } from "./api";

interface AdminContextValue {
  identity: Identity;
  organization: string;
  setOrganization: (id: string) => void;
  can: (resource: Resource, op: Operation) => boolean;
}
const AdminContext = createContext<AdminContextValue | null>(null);
export function AdminProvider({ children }: { children: ReactNode }) {
  const session = getSession()!;
  const [organization, setOrganization] = useState(
    session.identity.level >= 90 ? "" : session.identity.organizationId,
  );
  const can = (resource: Resource, op: Operation) =>
    canAccess(session.identity, resource.name, op) &&
    (["list", "show"].includes(op) ||
      session.services?.[resource.service]?.writable !== false);
  return (
    <AdminContext.Provider
      value={{ identity: session.identity, organization, setOrganization, can }}
    >
      {children}
    </AdminContext.Provider>
  );
}
export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("Admin context is unavailable");
  return value;
}
