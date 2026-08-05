import { Button, Card, Result } from "antd";

export const metadata = { title: "Account not set up · Application" };

/**
 * Reached when auth.users has a row but app_user does not — the signup trigger
 * didn't fire. Nothing the user can fix themselves, so this explains rather
 * than retries, and offers the one action that isn't a dead end.
 */
export default function OrphanedPage() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <Card style={{ maxWidth: 520 }}>
        <Result
          status="warning"
          title="Your account isn't finished"
          subTitle="You're signed in, but there's no profile record attached to this login. An administrator needs to finish setting the account up before you can use the dashboard."
          extra={
            <form action="/auth/signout" method="post">
              <Button htmlType="submit">Sign out</Button>
            </form>
          }
        />
      </Card>
    </main>
  );
}
