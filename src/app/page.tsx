import { redirect } from "next/navigation";

/**
 * There is no marketing surface — the proxy has already decided whether this
 * request carries a session, so the root only has to forward. Anonymous
 * requests are redirected to /login before they reach here.
 */
export default function Home() {
  redirect("/dashboard");
}
