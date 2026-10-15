import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { checkDevice, DEVICE_COOKIE, deviceCode, gateEnabled, validToken } from "@/lib/gate";

import { AccessCard } from "./access-card";

/** How this site is named to someone being asked to request access. */
const SITE = "Trueward Application";

export const metadata = { title: "Device access" };

/**
 * Where the device gate sends a browser that may not use this site yet: why,
 * the device code the admin will see, and a way to ask. Open to everyone —
 * the gate lets this path through, and so does the sign-in redirect.
 */
export default async function AccessPage() {
  // Read the request before anything else. Otherwise, built with the gate
  // off, Next would prerender this page as a static redirect to "/" — and
  // with the gate on in production, "/" and this page would bounce a
  // browser between them forever.
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!gateEnabled()) redirect("/");

  const status = validToken(token) ? await checkDevice(token, await headers()) : "unknown";
  if (status === "allowed") redirect("/");

  return (
    <AccessCard
      site={SITE}
      status={status}
      code={validToken(token) ? await deviceCode(token) : null}
      contact={process.env.NEXT_PUBLIC_GATE_CONTACT ?? null}
    />
  );
}
