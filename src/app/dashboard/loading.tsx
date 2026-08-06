import { Card, Skeleton } from "antd";

/**
 * Shown the instant a dashboard link is clicked, while the server component
 * behind it renders.
 *
 * Without this, App Router holds the *old* page on screen until the new one's
 * data has come back — so a navigation that costs an auth check plus a query
 * reads as a dead click, then a jump. The work takes the same time either way;
 * the difference is whether anything acknowledges the click.
 *
 * Deliberately generic. A per-page skeleton matching each layout would look
 * sharper for a moment and then be wrong the first time a page changed shape.
 */
export default function DashboardLoading() {
  return (
    <>
      <Skeleton active title={{ width: 220 }} paragraph={{ rows: 1, width: ["40%"] }} />
      <Card style={{ marginTop: 16 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    </>
  );
}
