"use server";

import { cookies, headers } from "next/headers";

import { DEVICE_COOKIE, gateEnabled, requestDeviceAccess, validToken } from "@/lib/gate";

/**
 * Asks the admin to approve this browser. The token comes from the cookie the
 * gate set, never from the form, so a request can only ever be for the
 * device it is sent from.
 */
export async function requestAccess(input: {
  name: string;
  note: string;
}): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  if (!gateEnabled()) return { ok: false, error: "The device gate is off on this site." };
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!validToken(token)) {
    return { ok: false, error: "This browser has no device id yet. Reload the page and try again." };
  }
  return requestDeviceAccess(token, await headers(), input.name, input.note);
}
