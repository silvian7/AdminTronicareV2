import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/api";
import {
  loadWorkspaceOrganization,
  saveWorkspaceOrganization,
} from "../src/workspace-preference";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    identity: {
      id: "100",
      name: "Synthetic platform administrator",
      organizationId: "7",
      userTypeId: "90",
      level: 90,
      mustChangePassword: false,
      permissions: [],
    },
    csrf: "synthetic-csrf",
    expiresAt: Date.now() + 60000,
    ...overrides,
  };
}

function storage() {
  const saved = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
  };
  vi.stubGlobal("window", { localStorage });
  return { saved, localStorage };
}

afterEach(() => vi.unstubAllGlobals());

describe("workspace organization preference", () => {
  it.each(["", "0", "7", "9223372036854775807"])(
    "restores the exact saved selection %j",
    (organization) => {
      storage();
      const current = session({ activeOrganizationId: "7" });
      saveWorkspaceOrganization(current, organization);
      expect(loadWorkspaceOrganization(current)).toBe(organization);
    },
  );

  it("keeps account and active membership preferences separate", () => {
    storage();
    const global = session();
    const membership = session({ activeOrganizationId: "7" });
    const other = session({ identity: { ...global.identity, id: "101" } });
    saveWorkspaceOrganization(global, "0");
    expect(loadWorkspaceOrganization(other)).toBe("");
    expect(loadWorkspaceOrganization(membership)).toBe("7");
    saveWorkspaceOrganization(membership, "");
    expect(loadWorkspaceOrganization(global)).toBe("0");
    expect(loadWorkspaceOrganization(membership)).toBe("");
  });

  it.each(["-1", "01", " 7", "7.0", "9223372036854775808", "invalid"])(
    "ignores invalid stored organization %j",
    (value) => {
      const { saved, localStorage } = storage();
      const current = session({ activeOrganizationId: "7" });
      saveWorkspaceOrganization(current, "0");
      const key = localStorage.setItem.mock.calls[0]![0];
      saved.set(key, value);
      expect(loadWorkspaceOrganization(current)).toBe("7");
      saveWorkspaceOrganization(current, value);
      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    },
  );

  it("uses ordinary administrators' authoritative organization despite a saved platform preference", () => {
    const { localStorage } = storage();
    const platform = session();
    saveWorkspaceOrganization(platform, "0");
    const ordinary = session({
      identity: { ...platform.identity, level: 30, userTypeId: "30" },
    });
    expect(loadWorkspaceOrganization(ordinary)).toBe("7");
    saveWorkspaceOrganization(ordinary, "");
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("falls back and allows filter changes when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Synthetic blocked storage");
      },
    });
    expect(loadWorkspaceOrganization(session())).toBe("");
    expect(
      loadWorkspaceOrganization(session({ activeOrganizationId: "7" })),
    ).toBe("7");
    expect(() => saveWorkspaceOrganization(session(), "0")).not.toThrow();
  });
});
