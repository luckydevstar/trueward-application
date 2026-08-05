"use client";

import {
  BlockOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LogoutOutlined,
  ProfileOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { canManageUsers, ROLE_META, type UserRole } from "@/lib/roles";
import { seesApplications } from "@/lib/scope";

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

  const items = [
    ...(seesApplications(role)
      ? [
          {
            key: "/dashboard/applications",
            icon: <ProfileOutlined />,
            label: <Link href="/dashboard/applications">Applications</Link>,
          },
          {
            key: "/dashboard/profiles",
            icon: <IdcardOutlined />,
            label: <Link href="/dashboard/profiles">Profiles</Link>,
          },
          {
            key: "/dashboard/resumes",
            icon: <FileTextOutlined />,
            label: <Link href="/dashboard/resumes">Resume builder</Link>,
          },
          {
            key: "/dashboard/blocklist",
            icon: <BlockOutlined />,
            label: <Link href="/dashboard/blocklist">Blocklist</Link>,
          },
        ]
      : []),
    ...(canManageUsers(role)
      ? [
          {
            key: "/dashboard/users",
            icon: <TeamOutlined />,
            label: <Link href="/dashboard/users">Users</Link>,
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
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);

  return (
    <Layout style={{ minHeight: "100dvh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        theme="dark"
      >
        <Link
          href="/dashboard"
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              flex: "0 0 auto",
              width: 26,
              height: 26,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, #2f5bea, #7c3aed)",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            T
          </span>
          {/*
            The mark stays when collapsed; only the wordmark is dropped, so the
            sider still reads as this product at 80px wide.
          */}
          {!collapsed && (
            <span style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>
              Trueward <span style={{ opacity: 0.65 }}>Guru</span>
            </span>
          )}
        </Link>
        <Menu theme="dark" mode="inline" selectedKeys={selected} items={items} />
      </Sider>

      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            paddingInline: 24,
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <Tag color={ROLE_META[role].color}>{ROLE_META[role].label}</Tag>
          <Dropdown
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
            <span style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar size="small" style={{ background: "#2f5bea" }}>
                {name.slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography.Text>{name}</Typography.Text>
            </span>
          </Dropdown>
        </Header>

        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
