import "server-only";

/**
 * Calls a database function with the public anon key, for the one route no
 * signed-in user is behind — the resume queue runner. The function it calls
 * is SECURITY DEFINER and checks a secret itself; the anon key reaches
 * nothing else.
 */
export async function anonRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `${fn} failed (${response.status})`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
