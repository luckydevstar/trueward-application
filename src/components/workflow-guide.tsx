"use client";

import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  BulbOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  IdcardOutlined,
  MessageOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Button, Card, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { usePersistentState } from "@/lib/persistent-state";
import type { UserRole } from "@/lib/roles";

/**
 * How the app is meant to be used, on the first page anyone sees.
 *
 * Two halves. The diagram is the same for everyone: what goes into a resume
 * and what comes out. The steps are per role, because each role's part of the
 * flow is different — the super admin sets the platform up, a subadmin keeps
 * profiles, a bidder works them — and each step links to where it happens.
 *
 * Hideable, and remembered per browser: it is for learning the app, and
 * someone who has will want the overview to themselves.
 */

type Step = { title: string; body: ReactNode; href?: string; cta?: string };

const STEPS: Record<UserRole, Step[]> = {
  super_admin: [
    {
      title: "Add subadmins",
      body: "Each subadmin runs one team: their profiles and the bidders they add.",
      href: "/dashboard/users",
      cta: "Users",
    },
    {
      title: "Choose the model and base prompt",
      body: "Compare models side by side in the Model lab, then save the one every resume uses.",
      href: "/dashboard/generation",
      cta: "Generation",
    },
    {
      title: "Hand profiles to subadmins",
      body: "On Profiles, the Subadmin column moves a profile, with its history, to that team.",
      href: "/dashboard/profiles",
      cta: "Profiles",
    },
    {
      title: "Work a profile yourself (optional)",
      body: "Switch on “Assigned to me” for a profile and it opens in your Resume builder, like a bidder’s.",
      href: "/dashboard/profiles",
      cta: "Profiles",
    },
    {
      title: "Watch the spend",
      body: "What generation costs, by subadmin, by person and by profile.",
      href: "/dashboard/usage",
      cta: "Usage",
    },
  ],
  subadmin: [
    {
      title: "Add your bidders",
      body: "Accounts for the people who will work your profiles.",
      href: "/dashboard/users",
      cta: "Users",
    },
    {
      title: "Add a profile",
      body: "The candidate’s identity, employers, dates and education. Set once; never rewritten by the model.",
      href: "/dashboard/profiles/new",
      cta: "New profile",
    },
    {
      title: "Add company context",
      body: (
        <>
          On the profile’s edit page, use <b>Copy prompt + employments</b>, run it in your AI
          chat, and paste the research back into <b>Company context</b>. It tells the model what
          each employer does.
        </>
      ),
      href: "/dashboard/profiles",
      cta: "Profiles",
    },
    {
      title: "Assign it",
      body: "The “Assigned to” column on Profiles decides which bidders can work it.",
      href: "/dashboard/profiles",
      cta: "Profiles",
    },
    {
      title: "Keep an eye on spend",
      body: "Generation cost by person and by profile.",
      href: "/dashboard/usage",
      cta: "Usage",
    },
  ],
  bidder: [
    {
      title: "Pick a profile",
      body: "Resume builder, step 1. You see the profiles assigned to you.",
      href: "/dashboard/resumes",
      cta: "Resume builder",
    },
    {
      title: "Paste the job and generate",
      body: "Paste the posting (company, title and URL if you have them) and press Generate. It runs in the background — paste the next one straight away, up to 6 at once.",
    },
    {
      title: "Open and check",
      body: "Click a ready one under Generations. Edit the JSON if something needs fixing; the preview is the real PDF.",
    },
    {
      title: "Download & track",
      body: "Add the company, job title and URL. The PDF downloads and the application is recorded with it attached.",
    },
    {
      title: "Answer follow-up questions",
      body: "Ask a screening question and copy the answer, written from the resume and the job.",
    },
    {
      title: "Keep Applications current",
      body: "Update the status as it moves — viewed, interviewing, offer.",
      href: "/dashboard/applications",
      cta: "Applications",
    },
  ],
};

const GUIDE_KEY = "tw.overview.guide";

export function WorkflowGuide({ role }: { role: UserRole }) {
  const [open, setOpen] = usePersistentState<boolean>(GUIDE_KEY, true);

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Button type="link" icon={<BulbOutlined />} style={{ paddingInline: 0 }} onClick={() => setOpen(true)}>
          Show how it works
        </Button>
      </div>
    );
  }

  return (
    <Card
      variant="borderless"
      style={{ marginBottom: 16 }}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <BulbOutlined style={{ color: "#4f46e5" }} />
          How it works
        </span>
      }
      extra={
        <Button type="text" size="small" onClick={() => setOpen(false)}>
          Hide
        </Button>
      }
    >
      <Flow />

      <Typography.Text strong style={{ display: "block", margin: "24px 0 12px" }}>
        {role === "super_admin" ? "Your part: set the platform up" : role === "subadmin" ? "Your part: keep the profiles" : "Your part: work your profiles"}
      </Typography.Text>
      <ol className="tw-steps">
        {STEPS[role].map((step, i) => (
          <li key={step.title} className="tw-step">
            <span className="tw-step-n" aria-hidden>
              {i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="tw-step-title">{step.title}</div>
              <div className="tw-step-body">{step.body}</div>
              {step.href && (
                <Link href={step.href} className="tw-step-link">
                  {step.cta} <ArrowRightOutlined style={{ fontSize: 11 }} />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      {role === "subadmin" && (
        <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0", fontSize: 13 }}>
          You can build resumes for any of your team’s profiles yourself, too — the steps are a
          bidder’s: pick, paste, generate, check, download &amp; track.
        </Typography.Paragraph>
      )}

      <style>{GUIDE_CSS}</style>
    </Card>
  );
}

/** One node in the diagram. */
function Node({ icon, title, note }: { icon: ReactNode; title: string; note: string }) {
  return (
    <div className="tw-node">
      <span className="tw-node-icon" aria-hidden>
        {icon}
      </span>
      <span className="tw-node-title">{title}</span>
      <span className="tw-node-note">{note}</span>
    </div>
  );
}

const Arrow = () => (
  <span className="tw-arrow" aria-hidden>
    <ArrowRightOutlined />
  </span>
);

/**
 * What goes into a resume, and what comes out — the same for every role.
 * Read as one sentence: these three inputs make the content, and the content
 * becomes a tracked application.
 */
function Flow() {
  return (
    <div role="img" aria-label="Profile, company context and job description go to the model, which writes the resume content; you check it, download and track it, then answer follow-up questions.">
      <div className="tw-row">
        <Node icon={<IdcardOutlined />} title="Profile" note="Employers, dates, education" />
        <span className="tw-plus" aria-hidden>+</span>
        <Node icon={<FileSearchOutlined />} title="Company context" note="What each employer does" />
        <span className="tw-plus" aria-hidden>+</span>
        <Node icon={<CopyOutlined />} title="Job description" note="Pasted per resume" />
      </div>

      <div className="tw-down" aria-hidden>
        <ArrowDownOutlined />
      </div>

      <div className="tw-core">
        <span className="tw-core-title">
          <RobotOutlined /> Base prompt + Profile + Company context + Job description
        </span>
        <span className="tw-core-note">
          The model writes the resume content for this job from the candidate’s real history — the
          prompt and model are set by the super admin.
        </span>
      </div>

      <div className="tw-down" aria-hidden>
        <ArrowDownOutlined />
      </div>

      <div className="tw-row">
        <Node icon={<FileSearchOutlined />} title="Check & edit" note="Editable JSON, live PDF preview" />
        <Arrow />
        <Node icon={<DownloadOutlined />} title="Download & track" note="PDF saved to Applications" />
        <Arrow />
        <Node icon={<MessageOutlined />} title="Follow-ups" note="Copyable answers" />
      </div>
    </div>
  );
}

const GUIDE_CSS = `
.tw-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 8px;
}
.tw-node {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  padding: 14px 10px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #edf0f5;
}
.tw-node-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: #eef0ff;
  color: #4f46e5;
  font-size: 15px;
  margin-bottom: 2px;
}
.tw-node-title { font-weight: 600; font-size: 14px; color: #0f172a; }
.tw-node-note { font-size: 12px; color: #64748b; }
.tw-plus, .tw-arrow {
  align-self: center;
  color: #94a3b8;
  font-size: 14px;
  flex: 0 0 auto;
}
.tw-plus { font-size: 18px; font-weight: 300; }
.tw-down {
  text-align: center;
  color: #94a3b8;
  margin: 8px 0;
}
.tw-core {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #c7d2fe;
  background: linear-gradient(180deg, #f5f7ff 0%, #ffffff 100%);
}
.tw-core-title {
  font-weight: 600;
  font-size: 15px;
  color: #0f172a;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.tw-core-title .anticon { color: #4f46e5; }
.tw-core-note { font-size: 13px; color: #64748b; max-width: 560px; }

.tw-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.tw-step {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #edf0f5;
}
.tw-step-n {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: #4f46e5;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.tw-step-title { font-weight: 600; font-size: 14px; color: #0f172a; margin-bottom: 2px; }
.tw-step-body { font-size: 13px; color: #475569; line-height: 1.5; }
.tw-step-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #4f46e5 !important;
}
.tw-step-link:hover { text-decoration: underline; }

@media (max-width: 640px) {
  .tw-row { flex-direction: column; }
  .tw-plus, .tw-arrow { transform: rotate(90deg); }
}
`;
