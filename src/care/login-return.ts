import { sessionLanding, type SessionInfo } from "../api";

/** Only a bounded, normalized local caregiver URL may survive sign-in. */
export function careLoginReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\x00-\x20\x7f\\]/.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)
  )
    return undefined;
  try {
    const url = new URL(value, "https://care-return.invalid");
    if (
      url.origin !== "https://care-return.invalid" ||
      !/^\/care(?:\/|$)/.test(url.pathname)
    )
      return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function careLoginDestination(value: SessionInfo, requested: unknown) {
  const target = careLoginReturnTo(requested);
  if (value.identity.mustChangePassword) return sessionLanding(value, !!target);
  return target ?? sessionLanding(value);
}
