import { describe, expect, it } from "vitest";
import {
  careLoginDestination,
  careLoginReturnTo,
} from "../src/care/login-return";
import type { SessionInfo } from "../src/api";
import { testIdentity } from "./fixtures";

const session: SessionInfo = {
  identity: testIdentity,
  csrf: "synthetic-login",
  expiresAt: 1,
};

describe("caregiver login destination", () => {
  it("preserves exact report IDs and filters and returns only the normalized local path", () => {
    const path =
      "/care/subjects/9223372036854775806/reports/9007199254740993?date=2026-10-25#readings";
    expect(careLoginReturnTo(path)).toBe(path);
    expect(careLoginReturnTo("/care/subjects/../?q=Bed%20A")).toBe(
      "/care/?q=Bed%20A",
    );
    expect(careLoginDestination(session, path)).toBe(path);
  });

  it.each([
    null,
    "",
    "https://example.invalid/care",
    "//example.invalid/care",
    "/\\example.invalid/care",
    "/care\\\\example.invalid",
    "/care/%5cexample.invalid",
    "/care/%0alogin",
    "/care/../../services",
    "/care/%2e%2e/services",
    "/caregiver",
    "/services",
    " /care",
    "/care\n",
    "/care/" + "x".repeat(2048),
  ])("rejects unsafe or unrelated return destinations (%s)", (path) => {
    expect(careLoginReturnTo(path)).toBeUndefined();
    expect(careLoginDestination(session, path)).toBe("/services");
  });

  it("prioritizes a required password change over the report and preserves care intent", () => {
    const changing = {
      ...session,
      identity: { ...testIdentity, mustChangePassword: true },
    };
    expect(careLoginDestination(changing, "/care/subjects/1/reports/2")).toBe(
      "/care/account",
    );
    expect(careLoginDestination(changing, "//example.invalid")).toBe(
      "/account",
    );
  });

  it("retains normal administrator and caregiver landing without a valid return request", () => {
    expect(careLoginDestination(session, undefined)).toBe("/services");
    const caregiver = {
      ...session,
      identity: { ...testIdentity, caregiverReadOnly: true },
    };
    expect(careLoginDestination(caregiver, undefined)).toBe("/care");
    expect(
      careLoginDestination(
        {
          ...caregiver,
          identity: { ...caregiver.identity, mustChangePassword: true },
        },
        "/services",
      ),
    ).toBe("/care/account");
  });
});
