import { describe, expect, it } from "vitest";
import { canAccess, type Operation } from "../shared/resources";
import { testIdentity } from "./fixtures";

describe("platform access settings", () => {
  it.each(["authz", "usertypes"])(
    "requires platform authority for every %s mutation even with entity rights",
    (name) => {
      const ordinary = { ...testIdentity, level: 30 };
      for (const operation of ["create", "edit", "delete"] as Operation[]) {
        expect(canAccess(ordinary, name, operation)).toBe(false);
        expect(canAccess(testIdentity, name, operation)).toBe(true);
      }
      expect(canAccess(ordinary, name, "list")).toBe(true);
      expect(canAccess(ordinary, name, "show")).toBe(true);
    },
  );
});
