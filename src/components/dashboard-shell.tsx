"use client";

import {
  AppstoreOutlined,
  BarChartOutlined,
  BlockOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuOutlined,
  ProfileOutlined,
  TableOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { canManageUsers, ROLE_META, type UserRole } from "@/lib/roles";
import { BRAND } from "@/lib/theme";

const { Header, Sider, Content } = Layout;

type Props = {
  name: string;
  email: string;
  role: UserRole;
  children: ReactNode;
};

export function DashboardShell({ name, email, role, children }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Below lg the navigation moves into a drawer, so a phone gets the whole
  // width. Unknown until the first measurement: treated as wide meanwhile.
  const screens = Grid.useBreakpoint();
  const narrow = screens.lg === false;

  /**
   * The records pages are for every role — a subadmin runs them, a bidder works
   * in them, a super admin reviews them — so only Users depends on who you
   * are. The pages and the policies decide what each role can do once there.
   */
  const items = [
    {
      key: "/dashboard",
      icon: <AppstoreOutlined />,
      label: <Link href="/dashboard">Overview</Link>,
      title: "Overview",
    },
    {
      key: "/dashboard/applications",
      icon: <ProfileOutlined />,
      label: <Link href="/dashboard/applications">Applications</Link>,
      title: "Applications",
    },
    {
      key: "/dashboard/profiles",
      icon: <IdcardOutlined />,
      label: <Link href="/dashboard/profiles">Profiles</Link>,
      title: "Profiles",
    },
    {
      key: "/dashboard/resumes",
      icon: <FileTextOutlined />,
      label: <Link href="/dashboard/resumes">Resume builder</Link>,
      title: "Resume builder",
    },
    {
      key: "/dashboard/jobs",
      icon: <TableOutlined />,
      label: <Link href="/dashboard/jobs">Jobs</Link>,
      title: "Jobs",
    },
    {
      key: "/dashboard/blocklist",
      icon: <BlockOutlined />,
      label: <Link href="/dashboard/blocklist">Blocklist</Link>,
      title: "Blocklist",
    },
    ...(canManageUsers(role)
      ? [
          {
            key: "/dashboard/users",
            icon: <TeamOutlined />,
            label: <Link href="/dashboard/users">Users</Link>,
            title: "Users",
          },
          // What generation has cost: a subadmin's team, or every team.
          {
            key: "/dashboard/usage",
            icon: <BarChartOutlined />,
            label: <Link href="/dashboard/usage">Usage</Link>,
            title: "Usage",
          },
        ]
      : []),
    // The model and system prompt the resume builder uses: platform settings.
    ...(role === "super_admin"
      ? [
          {
            key: "/dashboard/generation",
            icon: <ExperimentOutlined />,
            label: <Link href="/dashboard/generation">Generation</Link>,
            title: "Generation",
          },
        ]
      : []),
  ];

  /**
   * Longest matching prefix, not an exact match: /dashboard/profiles/<id>
   * must keep "Profiles" lit rather than clearing the whole menu. Sorting by
   * length first means a future /dashboard/profiles/archive item would win
   * over its parent instead of both matching.
   */
  const selected = items
    .map((item) => String(item.key))
    .filter((key) => pathname === key || (key !== "/dashboard" && pathname.startsWith(`${key}/`)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);
  const current = items.find((item) => item.key === selected[0]);
  const pageTitle = current?.title ?? (pathname.startsWith("/dashboard/account") ? "Account" : "");

  const brand = (compact: boolean) => (
    <Link
      href="/dashboard"
      onClick={() => setDrawerOpen(false)}
      style={{
        height: 64,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: compact ? "0 0 0 27px" : "0 20px",
        color: "#fff",
        whiteSpace: "nowrap",
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: BRAND.gradient,
          boxShadow: "0 6px 16px -6px rgba(139, 92, 246, 0.7)",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        T
      </span>
      {/*
        The mark stays when collapsed; only the wordmark is dropped, so the
        sider still reads as this product at 80px wide.
      */}
      {!compact && (
        <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: "-0.02em" }}>
          Trueward <span style={{ opacity: 0.55, fontWeight: 500 }}>Guru</span>
        </span>
      )}
    </Link>
  );

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selected}
      items={items.map((item) => ({ key: item.key, icon: item.icon, label: item.label }))}
      onClick={() => setDrawerOpen(false)}
      style={{ background: "transparent", borderInlineEnd: 0 }}
    />
  );

  return (
    <Layout style={{ minHeight: "100dvh" }}>
      {narrow ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={260}
          closable={false}
          styles={{ body: { padding: 0, background: BRAND.sider } }}
        >
          {brand(false)}
          {menu}
        </Drawer>
      ) : (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="dark"
          width={232}
          // Pinned, so the navigation stays put while a long page scrolls.
          style={{
            background: BRAND.sider,
            position: "sticky",
            top: 0,
            height: "100dvh",
            overflowY: "auto",
          }}
        >
          {brand(collapsed)}
          {menu}
        </Sider>
      )}

      <Layout>
        <Header
          style={{
            // Sticky and frosted: the grids scroll under it rather than taking
            // the account menu with them.
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingInline: narrow ? 12 : 28,
            borderBottom: `1px solid ${BRAND.line}`,
            backdropFilter: "saturate(180%) blur(12px)",
            WebkitBackdropFilter: "saturate(180%) blur(12px)",
          }}
        >
          {narrow && (
            <Button type="text" icon={<MenuOutlined />} aria-label="Open the menu" onClick={() => setDrawerOpen(true)} />
          )}
          <Typography.Text strong style={{ fontSize: 15, flex: 1, minWidth: 0 }} ellipsis>
            {pageTitle}
          </Typography.Text>
          {!narrow && (
            <Tag
              color={ROLE_META[role].color}
              bordered={false}
              style={{ borderRadius: 999, paddingInline: 10, fontWeight: 500 }}
            >
              {ROLE_META[role].label}
            </Tag>
          )}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "email",
                  label: (
                    <Typography.Text type="secondary">{email}</Typography.Text>
                  ),
                  disabled: true,
                },
                { type: "divider" },
                {
                  key: "account",
                  icon: <UserOutlined />,
                  label: <Link href="/dashboard/account">Account &amp; password</Link>,
                },
                {
                  key: "signout",
                  icon: <LogoutOutlined />,
                  label: (
                    // A form POST rather than a link: sign-out must not be
                    // reachable by prefetch or a cross-site <img> tag.
                    <form action="/auth/signout" method="post">
                      <button
                        type="submit"
                        style={{
                          all: "unset",
                          width: "100%",
                          cursor: "pointer",
                        }}
                      >
                        Sign out
                      </button>
                    </form>
                  ),
                },
              ],
            }}
          >
            <button
              type="button"
              aria-label={`Account menu for ${name}`}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: narrow ? 3 : "4px 10px 4px 4px",
                borderRadius: 999,
                border: `1px solid ${BRAND.line}`,
                background: "#fff",
                font: "inherit",
              }}
            >
              <Avatar size={28} style={{ background: BRAND.gradient, fontWeight: 600 }}>
                {name.slice(0, 1).toUpperCase()}
              </Avatar>
              {!narrow && <Typography.Text style={{ fontWeight: 500 }}>{name}</Typography.Text>}
            </button>
          </Dropdown>
        </Header>

        <Content style={{ padding: narrow ? "16px 16px 32px" : "28px 32px 40px", minWidth: 0 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
