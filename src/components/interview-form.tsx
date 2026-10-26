"use client";

import { App, DatePicker, Form, Input, Modal, Select, Tag, TimePicker, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useRef, useState } from "react";

import type { InterviewRow } from "@/components/interviews-sheet";
import {
  findApplications,
  INTERVIEW_OUTCOMES,
  interviewTitle,
  OUTCOME,
  saveInterview,
  type ApplicationChoice,
  type InterviewOutcome,
} from "@/lib/interviews";
import { applicationNo } from "@/lib/numbers";

/** What booking needs: the calendar's calendars, and the candidates this person may name. */
export type Booking = {
  calendars: Array<{ id: string; name: string }>;
  profiles: Array<{ id: string; name: string }>;
};

type Values = {
  calendarId?: string;
  date: Dayjs;
  start: Dayjs;
  end: Dayjs;
  company: string;
  role: string;
  profileId?: string;
  jobUrl?: string;
  location?: string;
  notes?: string;
  applicationId?: string;
  outcome: InterviewOutcome;
};

const WEB = /^https?:\/\/\S+$/i;

/** Minutes past midnight — a time picker's value carries a date nobody chose. */
const minutesOf = (time: Dayjs) => time.hour() * 60 + time.minute();

const choiceLabel = (a: ApplicationChoice) =>
  `${a.number} · ${a.company} — ${a.title}${a.candidate ? ` · ${a.candidate}` : ""}`;

/**
 * The form as it opens: a new interview at the next hour, for an hour, on
 * the calendar named for interviews if there is one; or the one being
 * changed, as it stands — a linked one, which says nothing for itself yet,
 * from its application.
 */
function initialValues(row: InterviewRow | null, booking: Booking): Values {
  if (!row) {
    const start = dayjs().add(1, "hour").startOf("hour");
    return {
      calendarId: (booking.calendars.find((c) => /interview/i.test(c.name)) ?? booking.calendars[0])?.id,
      date: start,
      start,
      end: start.add(1, "hour"),
      company: "",
      role: "",
      outcome: "scheduled",
    };
  }
  // An all-day event has no times to show; it gets these if it's saved.
  const start = row.all_day ? dayjs(row.starts_at).hour(9).minute(0) : dayjs(row.starts_at);
  const end = row.all_day ? start.add(1, "hour") : dayjs(row.ends_at);
  return {
    calendarId: row.calendarId ?? undefined,
    date: start,
    start,
    end,
    company: row.interview_company ?? row.application?.company ?? "",
    role: row.interview_role ?? row.application?.title ?? "",
    profileId: row.interview_profile_id ?? row.application?.profileId ?? undefined,
    jobUrl: row.interview_job_url ?? (row.application && WEB.test(row.application.jobUrl) ? row.application.jobUrl : undefined),
    location: row.location ?? undefined,
    notes: row.description ?? undefined,
    applicationId: row.application_id ?? undefined,
    outcome: row.outcome ?? "scheduled",
  };
}

/**
 * Adds an interview that didn't come from an application here — one
 * scheduled by email, say — or changes one. It goes on Trueward Calendar as
 * an event with what it is for (company, role, candidate, job link), so the
 * calendar and this page show the same thing; linking an application is
 * optional.
 *
 * Mounted per opening (the sheet drops it once the modal has closed), so the
 * form and its values start fresh each time.
 */
export function InterviewForm({
  row,
  booking,
  open,
  onClose,
  afterClose,
  onSaved,
}: {
  /** The interview being changed, or null to add one. */
  row: InterviewRow | null;
  booking: Booking;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [initial] = useState(() => initialValues(row, booking));
  const [busy, setBusy] = useState(false);
  const lastStart = useRef(initial.start);

  // The linked application, as an option before anything has been searched.
  const [choices, setChoices] = useState<ApplicationChoice[]>(() =>
    row?.application
      ? [
          {
            id: row.application.id,
            number: applicationNo(row.application.no, row.application.part),
            title: row.application.title,
            company: row.application.company,
            jobUrl: row.application.jobUrl,
            profileId: row.application.profileId,
            candidate: row.candidate,
          },
        ]
      : [],
  );
  const [searching, setSearching] = useState(false);
  const searched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      searched.current = true;
      setSearching(true);
      try {
        const found = await findApplications(text);
        // Keep the one already chosen, so its label survives a search that misses it.
        const chosen = choices.find((c) => c.id === form.getFieldValue("applicationId"));
        setChoices(chosen && !found.some((f) => f.id === chosen.id) ? [chosen, ...found] : found);
      } finally {
        setSearching(false);
      }
    }, 200);
  };

  // A candidate this person can't list — another team's — still shows as one.
  const profileOptions = booking.profiles.map((p) => ({ value: p.id, label: p.name }));
  if (initial.profileId && !booking.profiles.some((p) => p.id === initial.profileId)) {
    profileOptions.unshift({ value: initial.profileId, label: row?.candidate ?? "A candidate you can't see" });
  }

  /** Linking an application fills in whatever the form doesn't say yet. */
  const pickApplication = (id: string | undefined) => {
    const a = choices.find((c) => c.id === id);
    if (!a) return;
    const blank = (name: keyof Values) => !String(form.getFieldValue(name) ?? "").trim();
    form.setFieldsValue({
      ...(blank("company") ? { company: a.company } : {}),
      ...(blank("role") ? { role: a.title } : {}),
      ...(blank("profileId") && a.profileId && profileOptions.some((p) => p.value === a.profileId)
        ? { profileId: a.profileId }
        : {}),
      ...(blank("jobUrl") && WEB.test(a.jobUrl) ? { jobUrl: a.jobUrl } : {}),
    });
  };

  const submit = async (values: Values) => {
    if (!values.calendarId) return;
    // The browser's own wall clock, as instants.
    const at = (time: Dayjs) =>
      values.date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0).toISOString();
    const text = (value?: string) => value?.trim() || null;
    const company = values.company.trim();
    const role = values.role.trim();
    // A title the calendar gave it, or someone typed there, is kept; the one
    // this form wrote follows the company and role.
    const ours =
      !row ||
      !row.title.trim() ||
      row.title === interviewTitle(row.interview_company ?? "", row.interview_role ?? "");

    setBusy(true);
    const problem = await saveInterview(
      {
        calendarId: values.calendarId,
        title: ours ? interviewTitle(company, role) : row.title,
        startsAt: at(values.start),
        endsAt: at(values.end),
        company,
        role,
        profileId: values.profileId ?? null,
        jobUrl: text(values.jobUrl),
        location: text(values.location),
        notes: text(values.notes),
        applicationId: values.applicationId ?? null,
        outcome: values.outcome,
      },
      row?.event_id,
    );
    setBusy(false);
    if (problem) {
      message.error(problem);
      return;
    }
    message.success(row ? "Interview saved — the calendar shows the change." : `Interview with ${company} added to the calendar.`);
    onSaved();
  };

  return (
    <Modal
      title={row ? "Change interview" : "Add an interview"}
      open={open}
      onCancel={onClose}
      afterClose={afterClose}
      onOk={() => form.submit()}
      confirmLoading={busy}
      okText={row ? "Save" : "Add"}
      width={560}
    >
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initial}
        onFinish={submit}
        onValuesChange={(changed: Partial<Values>) => {
          if (!changed.start) return;
          // The end follows the start and keeps the length — an hour, to begin with.
          const end = form.getFieldValue("end") as Dayjs | undefined;
          const length = end ? minutesOf(end) - minutesOf(lastStart.current) : 0;
          form.setFieldValue("end", changed.start.add(length > 0 ? length : 60, "minute"));
          lastStart.current = changed.start;
        }}
      >
        {!row && (
          <Typography.Paragraph type="secondary">
            For an interview that didn&apos;t come from an application — one scheduled by email, say. It goes on the
            calendar as an event, so both show the same.
          </Typography.Paragraph>
        )}

        <Form.Item name="calendarId" label="Calendar" rules={[{ required: true, message: "Choose a calendar" }]}>
          <Select options={booking.calendars.map((c) => ({ value: c.id, label: c.name }))} placeholder="Calendar" />
        </Form.Item>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
          <Form.Item
            name="date"
            label="Date"
            rules={[{ required: true, message: "Choose a day" }]}
            extra={row?.all_day ? "All day on the calendar — saving gives it these times." : undefined}
            style={{ flex: "1 1 180px" }}
          >
            <DatePicker allowClear={false} format="ddd, MMM D, YYYY" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="start"
            label="Starts"
            rules={[{ required: true, message: "When does it start?" }]}
            style={{ flex: "0 1 130px" }}
          >
            <TimePicker
              allowClear={false}
              needConfirm={false}
              format="h:mm A"
              minuteStep={5}
              use12Hours
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="end"
            label="Ends"
            dependencies={["start"]}
            rules={[
              { required: true, message: "When does it end?" },
              ({ getFieldValue }) => ({
                validator: (_, end?: Dayjs) => {
                  const start = getFieldValue("start") as Dayjs | undefined;
                  return !end || !start || minutesOf(end) > minutesOf(start)
                    ? Promise.resolve()
                    : Promise.reject(new Error("The end has to be after the start."));
                },
              }),
            ]}
            style={{ flex: "0 1 130px" }}
          >
            <TimePicker
              allowClear={false}
              needConfirm={false}
              format="h:mm A"
              minuteStep={5}
              use12Hours
              style={{ width: "100%" }}
            />
          </Form.Item>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
          <Form.Item
            name="company"
            label="Company"
            rules={[{ required: true, whitespace: true, message: "Which company?" }, { max: 200 }]}
            style={{ flex: "1 1 200px" }}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, whitespace: true, message: "For which role?" }, { max: 200 }]}
            style={{ flex: "1 1 200px" }}
          >
            <Input />
          </Form.Item>
        </div>

        <Form.Item name="profileId" label="Candidate">
          <Select allowClear showSearch={{ optionFilterProp: "label" }} placeholder="Optional" options={profileOptions} />
        </Form.Item>

        <Form.Item
          name="jobUrl"
          label="Job link"
          rules={[{ pattern: WEB, message: "A link starting with http:// or https://" }, { max: 2000 }]}
        >
          <Input placeholder="Optional — https://…" />
        </Form.Item>

        <Form.Item name="location" label="Location or meeting link" rules={[{ max: 500 }]}>
          <Input placeholder="Optional" />
        </Form.Item>

        <Form.Item name="notes" label="Notes" rules={[{ max: 5000 }]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="Optional — shown on the calendar event" />
        </Form.Item>

        <Form.Item
          name="applicationId"
          label="Application"
          extra="Optional. Linked, it shows its resume and job description here and on the calendar."
        >
          <Select
            allowClear
            showSearch={{ filterOption: false, onSearch: search }}
            loading={searching}
            placeholder="Type its number — A007 — or a company"
            onOpenChange={(opening) => opening && !searched.current && search("")}
            onChange={pickApplication}
            options={choices.map((a) => ({ value: a.id, label: choiceLabel(a) }))}
            notFoundContent={searching ? "Searching…" : "No application with that number or name"}
          />
        </Form.Item>

        <Form.Item name="outcome" label="Outcome">
          <Select<InterviewOutcome>
            options={INTERVIEW_OUTCOMES.map((o) => ({
              value: o,
              label: (
                <Tag color={OUTCOME[o].color} bordered={false} style={{ margin: 0 }}>
                  {OUTCOME[o].label}
                </Tag>
              ),
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
