import { NextResponse, type NextRequest } from "next/server";

/**
 * The device gate: only approved browsers reach this site at all.
 *
 * The same file lives in trueward-application and trueward-calendar — keep
 * them identical. The schema, and the console where devices are approved, are
 * in trueward-auth.
 *
 * How it works:
 *
 *  - Every browser gets a random device token in `tw_device`, an HttpOnly
 *    cookie shared across *.trueward.guru (GATE_COOKIE_DOMAIN), so one
 *    approval request covers the device on every site.
 *  - Before anything else, proxy.ts asks the database whether that token may
 *    use this site (gate_check, with the public anon key; the token is hashed
 *    in the database and never stored). Anything but "allowed" sends a page to
 *    /access and refuses API calls and server actions with a 403 — before a
 *    login form is ever shown.
 *  - "Allowed" is remembered for PASS_SECONDS in a signed, host-only cookie,
 *    so a click doesn't cost a database round trip. Blocking a device takes
 *    effect within that minute.
 *
 * Off unless GATE_ENABLED=true, so local development and a deploy without
 * the env vars behave exactly as before.
 */

export const DEVICE_COOKIE = "tw_device";
/**
 * The same token in a header, for the Chrome extension: its requests can't be
 * relied on to carry the site's cookies, so it reads this browser's device
 * cookie (chrome.cookies) and sends it here. Same secret, same check — an
 * extension in a browser nobody approved is refused like the browser itself.
 */
export const DEVICE_HEADER = "x-trueward-device";
const PASS_COOKIE = "tw_gate";
const PASS_SECONDS = 60;
/** Chrome's ceiling for a cookie's lifetime; it slides on every fresh check. */
const DEVICE_MAX_AGE = 400 * 86_400;
/** 32 random bytes, base64url. Anything else in the cookie is replaced. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type GateStatus =
  | "allowed"
  | "not_permitted"
  | "pending"
  | "blocked"
  | "unknown"
  | "unknown_app"
  | "error";

export function gateEnabled(): boolean {
  return process.env.GATE_ENABLED === "true";
}

function appKey(): string {
  return process.env.GATE_APP_KEY ?? "";
}

const encoder = new TextEncoder();

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function validToken(token: string | undefined): token is string {
  return Boolean(token && TOKEN_SHAPE.test(token));
}

/** The code shown on the access page and in the console: the hash's first eight digits. */
export async function deviceCode(token: string): Promise<string> {
  const hex = Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(token))).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`.toUpperCase();
}

function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `The device check failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

/** What the database says about this device on this site. Never throws. */
export async function checkDevice(token: string, headers: Headers): Promise<GateStatus> {
  try {
    return await rpc<GateStatus>("gate_check", {
      p_token: token,
      p_app: appKey(),
      p_ip: clientIp(headers),
      p_ua: headers.get("user-agent"),
    });
  } catch {
    return "error";
  }
}

/** Files an access request for this device, from this site. */
export async function requestDeviceAccess(
  token: string,
  headers: Headers,
  name: string,
  note: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  try {
    const status = await rpc<string>("gate_request", {
      p_token: token,
      p_app: appKey(),
      p_name: name,
      p_note: note,
      p_ip: clientIp(headers),
      p_ua: headers.get("user-agent"),
    });
    return { ok: true, status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The request couldn't be sent." };
  }
}

/* -------------------------------------------------------------- the pass */

async function sign(value: string): Promise<string | null> {
  const secret = process.env.GATE_SECRET;
  // No secret, no pass: every request is checked, which is slower but safe.
  if (!secret || secret.length < 16) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(await crypto.subtle.sign("HMAC", key, encoder.encode(value))).toString("base64url");
}

/** Constant-time, so a forged pass can't be found a character at a time. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Bound to the device token, the site and the expiry, so it can't be moved to another device. */
async function issuePass(token: string): Promise<string | null> {
  const expires = Math.floor(Date.now() / 1000) + PASS_SECONDS;
  const signature = await sign(`${token}|${appKey()}|${expires}`);
  return signature ? `${expires}.${signature}` : null;
}

async function passHolds(token: string, pass: string | undefined): Promise<boolean> {
  if (!pass) return false;
  const [expiresPart, signature] = pass.split(".");
  const expires = Number(expiresPart);
  if (!expires || !signature || expires < Date.now() / 1000) return false;
  const expected = await sign(`${token}|${appKey()}|${expires}`);
  return expected !== null && same(expected, signature);
}

/* -------------------------------------------------------------- the gate */

type CookieOptions = Parameters<NextResponse["cookies"]["set"]>[2];
type Cookie = { name: string; value: string; options: CookieOptions };

function deviceCookie(token: string): Cookie {
  const domain = process.env.GATE_COOKIE_DOMAIN;
  return {
    name: DEVICE_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_MAX_AGE,
      ...(domain ? { domain } : {}),
    },
  };
}

const REFUSALS: Record<Exclude<GateStatus, "allowed">, string> = {
  not_permitted: "This device isn't approved for this site.",
  pending: "This device is waiting for approval.",
  blocked: "This device has been blocked.",
  unknown: "This device isn't approved yet.",
  unknown_app: "This site isn't registered with the device gate.",
  error: "The device couldn't be checked. Try again in a moment.",
};

export type Gate = {
  /** The response to send instead, when this request may not continue. */
  blocked: NextResponse | null;
  /** Adds the gate's cookies to whatever response the proxy goes on to send. */
  finish: (response: NextResponse) => NextResponse;
};

/**
 * Runs the gate for one request. `open` names the paths it lets through
 * unchecked — the access page itself, and server-to-server callbacks.
 */
export async function runGate(request: NextRequest, open: (pathname: string) => boolean): Promise<Gate> {
  if (!gateEnabled()) return { blocked: null, finish: (response) => response };

  const cookies: Cookie[] = [];
  const finish = (response: NextResponse) => {
    for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
    return response;
  };

  let token = request.cookies.get(DEVICE_COOKIE)?.value ?? request.headers.get(DEVICE_HEADER) ?? undefined;
  const minted = !validToken(token);
  if (!validToken(token)) {
    token = newToken();
    // On the request as well, so the page rendering it (the access page)
    // sees the token the browser is about to receive.
    request.cookies.set(DEVICE_COOKIE, token);
    cookies.push(deviceCookie(token));
  }

  const { pathname } = request.nextUrl;
  if (open(pathname)) return { blocked: null, finish };

  if (!minted && (await passHolds(token, request.cookies.get(PASS_COOKIE)?.value))) {
    return { blocked: null, finish };
  }

  // A token minted this instant can't have been approved; skip the round trip.
  const status: GateStatus = minted ? "unknown" : await checkDevice(token, request.headers);

  if (status === "allowed") {
    const pass = await issuePass(token);
    if (pass) {
      cookies.push({
        name: PASS_COOKIE,
        value: pass,
        options: {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: PASS_SECONDS,
        },
      });
    }
    cookies.push(deviceCookie(token));
    return { blocked: null, finish };
  }

  // Pages go to the explanation; anything else gets a status a fetch can read.
  if (request.method === "GET" && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/access";
    url.search = "";
    return { blocked: finish(NextResponse.redirect(url)), finish };
  }
  return {
    blocked: finish(NextResponse.json({ error: REFUSALS[status] }, { status: status === "error" ? 503 : 403 })),
    finish,
  };
}
