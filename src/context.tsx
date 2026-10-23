import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Identity, Resource, Operation } from "../shared/resources";
import { canAccess } from "../shared/resources";
import { getSession } from "./api";

interface AdminContextValue {
  identity: Identity;
  organization: string;
  setOrganization: (id: string) => void;
  can: (resource: Resource, op: Operation) => boolean;
  confirmOrganizationChange: () => Promise<boolean>;
  registerOrganizationChangeGuard: (
    guard: () => boolean | Promise<boolean>,
  ) => () => void;
}
const AdminContext = createContext<AdminContextValue | null>(null);
export function AdminProvider({ children }: { children: ReactNode }) {
  const session = getSession()!;
  const [organization, setOrganization] = useState(
    session.identity.level >= 90
      ? (session.activeOrganizationId ?? "")
      : session.identity.organizationId,
  );
  const organizationGuard = useRef<(() => boolean | Promise<boolean>) | null>(
    null,
  );
  const registerOrganizationChangeGuard = useCallback(
    (guard: () => boolean | Promise<boolean>) => {
      organizationGuard.current = guard;
      return () => {
        if (organizationGuard.current === guard)
          organizationGuard.current = null;
      };
    },
    [],
  );
  const confirmOrganizationChange = useCallback(
    async () =>
      organizationGuard.current ? await organizationGuard.current() : true,
    [],
  );
  const can = (resource: Resource, op: Operation) =>
    canAccess(session.identity, resource.name, op) &&
    (["list", "show"].includes(op) ||
      session.services?.[resource.service]?.writable !== false);
  return (
    <AdminContext.Provider
      value={{
        identity: session.identity,
        organization,
        setOrganization,
        can,
        confirmOrganizationChange,
        registerOrganizationChangeGuard,
      }}
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
