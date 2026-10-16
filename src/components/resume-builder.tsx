"use client";

import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  LoadingOutlined,
  RedoOutlined,
  SendOutlined,
  RobotOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { DefaultOptionType } from "antd/es/select";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  askFollowUp,
  attachApplicationResume,
  generateResumeContent,
  recordApplication,
  startResumeJob,
  type GenerateResult,
} from "@/app/dashboard/resumes/actions";
import {
  DEFAULT_STYLE,
  ResumeStyleToolbar,
} from "@/components/resume-style-toolbar";
import { JOB_STALE_MS, MAX_RUNNING_JOBS } from "@/lib/ai/defaults";
import {
  EXAMPLE_DOCUMENT,
  EXAMPLE_PROFILE_ID,
} from "@/lib/document/example";
import {
  contentSchema,
  fieldErrors,
  formatMonthYear,
  monthYearKey,
  resumeDocumentSchema,
  type ResumeProfile,
} from "@/lib/document/schema";
import {
  downloadResumePdf,
  renderResumePdfBlob,
  renderResumePdfUrl,
  resumeFileName,
  saveBlob,
} from "@/lib/pdf/resume-pdf";
import { headerSegments, resolveHeaderFields } from "@/lib/resume-header";
import type { TemplateSpec } from "@/lib/pdf/templates";
import { usePersistentState } from "@/lib/persistent-state";
import { coerceChoice } from "@/lib/style-access";
import { createClient } from "@/lib/supabase/client";
import { useUploadThing } from "@/lib/uploadthing";
import { formatDate } from "@/lib/status";
import type { ResumeJobRow, ResumeStyle } from "@/lib/supabase/types";

type ProfileOption = {
  id: string;
  fullName: string;
  /** Whether the profile has company context on file for generation. */
  hasCompanyContext?: boolean;
  /** The profile's team: where a resume or application for it is filed. */
  teamId?: string;
  /**
   * For a super admin: whether they have assigned it to themselves, and so
   * may generate, save and track for it rather than only review.
   */
  workable?: boolean;
  profile: ResumeProfile | null;
  error: string | null;
};

type DocumentRow = {
  id: string;
  title: string;
  profile_id: string;
  content: unknown;
  template: string;
  style: ResumeStyle;
  updated_at: string;
  created_by: string | null;
};

type Props = {
  profiles: ProfileOption[];
  documents: DocumentRow[];
  teamId: string;
  userId: string;
  templates: TemplateSpec[];
  accents: string[];
  /** A subadmin may overwrite any resume on their team, not only their own. */
  canEditAny: boolean;
  /**
   * A super admin reviews: they may render and download, never save — except
   * on profiles they have assigned to themselves (`workable`), which they
   * work like a bidder.
   */
  readOnly: boolean;
  /** Whether Generate works. Prompt and model are the super admin's. */
  generation: { enabled: boolean };
  /**
   * Your background generations, newest first. Null when the database has no
   * resume_job table yet — Generate then runs in the request, as it used to.
   */
  jobs?: ResumeJobRow[] | null;
};

type Answer = { question: string; answer: string; costUsd: number | null; latencyMs: number };

/** The last generation's receipt, shown under the button. */
type Run = Extract<GenerateResult, { ok: true }>;

/**
 * The steps grow to their full height and scroll with the page — nothing sits
 * hidden inside a fixed box — while the preview column stays pinned beside
 * them at the viewport's height, so whatever step you are on, the resume is in
 * view. The offset is the dashboard's sticky header (64px) plus a gap.
 */
const STICKY_TOP = 80;

/** Template and styling, remembered together so they can't fall out of step. */
type Preset = { template: string; style: ResumeStyle };

const STYLE_STORAGE_KEY = "tw.resume.style";

/**
 * Where the content comes from: generated here, or pasted from elsewhere.
 * Generating is the main path; pasting is the fallback for when a model run
 * elsewhere is preferred, or generation isn't set up. Remembered, since a
 * person tends to work one way.
 */
type Source = "ai" | "paste";
const SOURCE_KEY = "tw.resume.source";

const DEFAULT_PRESET: Preset = { template: "banner", style: DEFAULT_STYLE };

/** Strips the ```json fence a model wraps its output in. */
function unfence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * The demo option, always last in the dropdown.
 *
 * With nothing assigned it is the only option and is selected on load, so the
 * page is explorable — style controls, preview and download all work — rather
 * than being an empty state that explains what you're missing. It cannot be
 * saved: there is no candidate_profile row for it to reference.
 */
const EXAMPLE_OPTION: ProfileOption = {
  id: EXAMPLE_PROFILE_ID,
  fullName: "Example candidate (demo)",
  profile: EXAMPLE_DOCUMENT.profile,
  error: null,
};

export function ResumeBuilder({
  profiles,
  documents,
  teamId,
  userId,
  templates,
  accents,
  canEditAny,
  readOnly,
  generation,
  jobs: initialJobs = null,
}: Props) {
  const router = useRouter();
  const { message, modal } = App.useApp();

  /*
   * The job a new generation is for. The base prompt, model and reasoning are
   * the super admin's and stay on the server. Company, title and URL are
   * optional here: they travel with the generation and pre-fill Apply.
   */
  const [jobDescription, setJobDescription] = useState("");
  const [draftCompany, setDraftCompany] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");

  /*
   * Background generations. Each runs on the server after Generate returns,
   * so several can be in flight; the list is polled while any is running and
   * re-read when the tab regains focus, which is what picks up one started in
   * another tab. `openJobId` is the one loaded into the editor, whose edits
   * are saved back to its row.
   */
  const jobsEnabled = initialJobs !== null;
  const [jobs, setJobs] = useState<ResumeJobRow[]>(initialJobs ?? []);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  /** Ticks while something runs: elapsed times, and when a row has timed out. */
  const [now, setNow] = useState(0);

  // Step 4: where this resume is going, so downloading it also tracks it.
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [tracking, setTracking] = useState(false);
  const { startUpload } = useUploadThing("applicationResume");

  // Step 5: questions about this resume and job, answered by the same model.
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  /** Answers per open generation ("scratch" for anything else), kept while you switch. */
  const [answersByKey, setAnswersByKey] = useState<Record<string, Answer[]>>({});
  const [source, setSource] = usePersistentState<Source>(SOURCE_KEY, "ai");
  const [generating, setGenerating] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);

  const options = useMemo(() => [...profiles, EXAMPLE_OPTION], [profiles]);

  // A real profile wins when one exists — one you can work, for a super admin
  // — and the demo is the fallback, not the default.
  const [profileId, setProfileId] = useState(
    (readOnly ? profiles.find((p) => p.workable) : undefined)?.id ??
      profiles[0]?.id ??
      EXAMPLE_PROFILE_ID,
  );
  const [documentId, setDocumentId] = useState("");
  const [title, setTitle] = useState("");
  const [json, setJson] = useState(() =>
    profiles.length ? "" : JSON.stringify(EXAMPLE_DOCUMENT.content, null, 2),
  );
  /**
   * Styling survives navigation.
   *
   * It is a working preference, not a property of any one resume — you settle
   * on a template and a leading you like and then produce several documents
   * with it. Resetting to defaults on every visit meant redoing that each time.
   *
   * Opening a saved resume still overrides this with that document's own style,
   * and doing so updates the remembered preference, which is the behaviour you
   * want: the last thing you looked at is where you carry on from.
   */
  const [preset, setPreset] = usePersistentState<Preset>(
    STYLE_STORAGE_KEY,
    DEFAULT_PRESET,
  );
  /**
   * Snapped inside the allowance before use. The preset is remembered in
   * localStorage and a saved resume carries its own, so either can name a
   * template or accent this account is no longer offered — rendering the old
   * one would show something the picker cannot represent.
   */
  const template = useMemo(
    () =>
      coerceChoice(
        preset.template,
        templates.map((t) => t.id),
        DEFAULT_PRESET.template,
      ),
    [preset.template, templates],
  );

  /**
   * Memoised, not just computed. The preview effect below depends on this
   * object, so a fresh one each render would reset its debounce timer on every
   * render — including renders that had nothing to do with styling — and the
   * PDF would only ever appear during a lull.
   */
  const style: ResumeStyle = useMemo(
    () => ({
      ...preset.style,
      accent: coerceChoice(preset.style.accent, accents, accents[0]),
    }),
    [preset.style, accents],
  );
  const setTemplate = (next: string) => setPreset((p) => ({ ...p, template: next }));
  const setStyle = (next: ResumeStyle | ((previous: ResumeStyle) => ResumeStyle)) =>
    setPreset((p) => ({
      ...p,
      style: typeof next === "function" ? next(p.style) : next,
    }));

  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const selectedProfile = options.find((p) => p.id === profileId);
  const isExample = profileId === EXAMPLE_PROFILE_ID;
  /** Viewing without being able to save or track: a super admin, on a profile not assigned to them. */
  const reviewOnly = readOnly && !selectedProfile?.workable;
  const profileDocuments = documents.filter((d) => d.profile_id === profileId);

  /*
   * Whether "Save" overwrites the open resume or files a new one.
   *
   * A bidder can open a teammate's resume for the same candidate — sharing a
   * profile shares its resumes — but the policies let only its author (or the
   * subadmin) change it. Offering "Save" there would update nothing and still
   * report success, so their save becomes a copy of their own instead.
   */
  const openDocument = profileDocuments.find((d) => d.id === documentId);
  const overwrites =
    Boolean(openDocument) && (canEditAny || openDocument?.created_by === userId);

  const pickProfile = (id: string) => {
    setProfileId(id);
    setLastRun(null);
    setOpenJobId(null);
    setAnswersByKey((all) => {
      const next = { ...all };
      delete next.scratch;
      return next;
    });
    // Documents belong to one profile; keeping a selection across a switch
    // would show content whose employmentIds can't resolve.
    setDocumentId("");
    setTitle("");
    // Switching *to* the demo prefills its content so it renders immediately;
    // switching to a real candidate clears it, because example bullets under
    // someone's real name is the wrong default.
    setJson(id === EXAMPLE_PROFILE_ID ? JSON.stringify(EXAMPLE_DOCUMENT.content, null, 2) : "");
  };

  const pickDocument = (id: string) => {
    const doc = profileDocuments.find((d) => d.id === id);
    setOpenJobId(null);
    setDocumentId(id);
    setTitle(doc?.title ?? "");
    setJson(doc ? JSON.stringify(doc.content, null, 2) : "");
    // One write rather than two, so the persisted preset never briefly holds a
    // document's template against the previous style.
    setPreset({
      template: doc?.template ?? DEFAULT_PRESET.template,
      style: { ...DEFAULT_STYLE, ...(doc?.style ?? {}) },
    });
  };

  /**
   * Validation runs on every keystroke against the same schema the write path
   * uses, so Download can never be enabled for a document that wouldn't survive
   * being saved.
   */
  const parsed = useMemo(() => {
    if (!selectedProfile?.profile) {
      return { kind: "noprofile" as const };
    }

    const raw = unfence(json);
    if (!raw) return { kind: "empty" as const };

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        kind: "syntax" as const,
        message: error instanceof Error ? error.message : "Invalid JSON",
      };
    }

    const content = contentSchema.safeParse(value);
    if (!content.success) {
      return { kind: "invalid" as const, errors: fieldErrors(content.error) };
    }

    /**
     * Unresolvable employmentIds get their own branch rather than joining the
     * generic error list.
     *
     * It is by far the most common failure — a model writes whatever id it
     * likes unless told the profile's — and it is the one with an obvious fix,
     * so it earns a specific message and a remap action instead of four
     * identical "unknown employmentId" lines.
     */
    const known = new Set(selectedProfile.profile.employments.map((e) => e.id));
    const unknown = content.data.experiences
      .map((x) => x.employmentId)
      .filter((id) => !known.has(id));

    if (unknown.length) {
      return {
        kind: "idmismatch" as const,
        unknown,
        expected: [...known],
        // Positional remap is only meaningful when the two lists line up.
        remappable: content.data.experiences.length === known.size,
      };
    }

    // The document-level parse is the one that matters: it checks every
    // employmentId against the profile and rejects experiences that aren't
    // most-recent-first. contentSchema alone cannot see the profile.
    const doc = resumeDocumentSchema.safeParse({
      schemaVersion: 2,
      profile: selectedProfile.profile,
      content: content.data,
    });
    if (!doc.success) {
      return { kind: "invalid" as const, errors: fieldErrors(doc.error) };
    }
    return { kind: "ok" as const, document: doc.data };
  }, [json, selectedProfile]);

  const save = async () => {
    if (parsed.kind !== "ok") return;
    if (isExample) {
      message.info("The demo profile can't be saved. Pick a real candidate first.");
      return;
    }
    if (!title.trim()) {
      message.error("Give the resume a title.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      title: title.trim(),
      profile_id: profileId,
      content: parsed.document.content,
      template,
      style,
    };

    // `.select()` so an update RLS quietly refused comes back as zero rows
    // rather than as a success with nothing saved.
    const { data, error } = overwrites
      ? await supabase
          .from("resume_document")
          .update(payload)
          .eq("id", documentId)
          .select("id")
      : await supabase
          .from("resume_document")
          // A super admin has no team; theirs joins the profile's.
          .insert({ ...payload, team_id: teamId || selectedProfile?.teamId || "", created_by: userId })
          .select("id");
    setSaving(false);

    if (error) {
      message.error(error.message);
      return;
    }
    if (!data?.length) {
      message.error(
        "That resume can't be changed from this account. Try “Save as new”.",
      );
      return;
    }
    message.success("Saved.");
    router.refresh();
  };

  const download = async () => {
    if (parsed.kind !== "ok") return;
    setDownloading(true);
    try {
      const saved = await downloadResumePdf(parsed.document, style, template);
      if (saved) message.success("Resume downloaded.");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not create the PDF.",
      );
    } finally {
      setDownloading(false);
    }
  };

  /**
   * The preview is the real PDF, re-rendered as you type.
   *
   * Debounced because each render allocates a document and a blob URL; 250ms
   * keeps typing smooth while still feeling live for a slider drag. The
   * setState happens inside the timer rather than in the effect body, which is
   * both what makes the debounce work and what keeps this out of a cascading
   * render.
   *
   * Every URL is revoked — on replacement and on unmount — or a long editing
   * session leaks one document per keystroke.
   */
  const [preview, setPreview] = useState<{ url: string; sig: string } | null>(
    null,
  );

  const validDocument = parsed.kind === "ok" ? parsed.document : null;

  // Everything that changes the output. Comparing against the signature the
  // current blob was rendered from is what tells us whether it is still
  // current — derived rather than cleared from inside the effect, which would
  // be a setState cascade on every keystroke.
  const sig = validDocument ? `${template}|${JSON.stringify(style)}|${json}` : "";
  const previewUrl = preview?.sig === sig ? preview.url : null;

  useEffect(() => {
    if (!validDocument) return;

    let stale = false;

    const timer = setTimeout(() => {
      renderResumePdfUrl(validDocument, style, template)
        .then((url) => {
          // The inputs changed while this render was in flight.
          if (stale) {
            URL.revokeObjectURL(url);
            return;
          }
          setPreview((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return { url, sig };
          });
        })
        .catch(() => {
          // A document that validated should always render; if it somehow
          // doesn't, the panel shows its spinner rather than breaking.
        });
    }, 250);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [validDocument, style, template, sig]);

  // Release the last blob when the page goes away; the effect above only
  // revokes on replacement, so without this the final one outlives the view.
  useEffect(
    () => () => {
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return null;
      });
    },
    [],
  );

  const employmentIds = selectedProfile?.profile?.employments.map((e) => e.id) ?? [];

  /**
   * Seeds the editor with a content skeleton for the selected profile.
   *
   * The employmentIds are the part worth generating: they must match the
   * profile exactly and be ordered most-recent-first, and getting either wrong
   * is the most common reason a pasted document won't validate. Everything else
   * is obvious placeholder prose to be replaced or pasted over.
   */
  /** Profile employments, newest first — the order experiences must follow. */
  const orderedEmployments = useMemo(
    () =>
      [...(selectedProfile?.profile?.employments ?? [])].sort(
        (a, b) => monthYearKey(b.startDate) - monthYearKey(a.startDate),
      ),
    [selectedProfile],
  );

  /**
   * Rewrites the pasted experiences' ids onto the profile's, by position.
   *
   * Positional, because that is the only correspondence available — the ids
   * don't match, so there is nothing to match *on*. It is offered only when the
   * counts are equal, and the mapping is shown before it is applied, because
   * getting it wrong attaches someone's bullets to the wrong employer.
   */
  const remapIds = () => {
    try {
      const value = JSON.parse(unfence(json));
      value.experiences = (value.experiences ?? []).map(
        (x: { employmentId: string }, i: number) => ({
          ...x,
          employmentId: orderedEmployments[i]?.id ?? x.employmentId,
        }),
      );
      setJson(JSON.stringify(value, null, 2));
      message.success("Ids remapped to this profile.");
    } catch {
      message.error("Couldn't rewrite the JSON.");
    }
  };

  const startFromProfile = () => {
    if (!selectedProfile?.profile) return;

    setJson(
      JSON.stringify(
        {
          targetTitle: "Target role",
          summary: "One paragraph on how this candidate fits the role.",
          skills: [{ name: "Category", items: ["Skill"] }],
          experiences: orderedEmployments.map((e) => ({
            employmentId: e.id,
            title: "Role title",
            bullets: [{ text: `What they did at ${e.company}, with a metric.` }],
          })),
        },
        null,
        2,
      ),
    );
  };

  const openJob = jobs.find((j) => j.id === openJobId) ?? null;
  const answerKey = openJobId ?? "scratch";
  const answers = answersByKey[answerKey] ?? [];

  /** A row still "running" after the function's limit was cut off. */
  const timedOut = (job: ResumeJobRow) =>
    job.status === "running" && now > 0 && now - Date.parse(job.created_at) > JOB_STALE_MS;
  const runningCount = jobs.filter((j) => j.status === "running" && !timedOut(j)).length;
  const anyRunning = runningCount > 0;

  /** Loads a finished generation into the editor, the preview and Apply. */
  const showJob = (job: ResumeJobRow) => {
    if (job.status !== "ready") return;
    const option = options.find((p) => p.id === job.profile_id);
    if (!option?.profile) {
      message.warning("That profile isn't available to you any more.");
      return;
    }
    setProfileId(job.profile_id);
    setOpenJobId(job.id);
    setDocumentId("");
    setTitle(jobLabel(job, false));
    setJson(JSON.stringify(job.content, null, 2));
    setCompany(job.company ?? "");
    setJobTitle(job.job_title ?? "");
    setJobUrl(job.job_url ?? "");
    setLastRun(null);
  };

  /** Back to a blank editor: nothing open. */
  const closeDocument = () => {
    setOpenJobId(null);
    setDocumentId("");
    setTitle("");
    setJson("");
    setCompany("");
    setJobTitle("");
    setJobUrl("");
    setLastRun(null);
  };

  /**
   * Re-reads your recent generations, and says when one finishes.
   *
   * Called by the poll and on focus. Kept in a ref so those long-lived
   * listeners always run the current render's version — with today's
   * `openJobId` and editor — rather than the one they were set up with.
   */
  const refreshJobs = async () => {
    const { data, error } = await createClient()
      .from("resume_job")
      .select("*")
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30);
    if (error || !data) return;

    const before = new Map(jobs.map((j) => [j.id, j.status]));
    const finished = data.filter((j) => before.get(j.id) === "running" && j.status !== "running");
    setJobs(data);
    setNow(Date.now());

    for (const job of finished) {
      const label = jobLabel(job);
      if (job.status === "failed") message.error(`Generation failed: ${label}`);
      else if (job.valid) message.success(`Ready: ${label}`);
      else message.warning(`Ready, but needs a fix: ${label}`);
    }
    // Nothing open and nothing typed: open the first one that finished, so a
    // single generation still feels like pressing a button and getting a
    // resume.
    const first = finished.find((j) => j.status === "ready");
    if (first && !openJobId && !json.trim()) showJob(first);
  };
  const refreshRef = useRef(refreshJobs);
  useEffect(() => {
    refreshRef.current = refreshJobs;
  });

  // Poll while anything runs; the clock ticks with it for the elapsed times.
  useEffect(() => {
    if (!jobsEnabled || !anyRunning) return;
    const poll = setInterval(() => void refreshRef.current(), 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [jobsEnabled, anyRunning]);

  // Coming back to the tab picks up anything started or finished elsewhere.
  useEffect(() => {
    if (!jobsEnabled) return;
    const onFocus = () => void refreshRef.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [jobsEnabled]);

  /*
   * Edits to an open generation are saved back to its row, a moment after
   * typing stops, so switching to another row and back loses nothing. Only
   * JSON that parses is saved; Apply's fields go with it.
   */
  useEffect(() => {
    if (!openJob) return;
    const timer = setTimeout(async () => {
      let content: unknown = openJob.content;
      try {
        content = JSON.parse(unfence(json));
      } catch {
        // Mid-edit; the last good version stays saved.
      }
      const next = {
        content,
        valid: parsed.kind === "ok",
        company: company.trim() || null,
        job_title: jobTitle.trim() || null,
        job_url: jobUrl.trim() || null,
      };
      const changed =
        JSON.stringify(next.content) !== JSON.stringify(openJob.content) ||
        next.valid !== openJob.valid ||
        next.company !== openJob.company ||
        next.job_title !== openJob.job_title ||
        next.job_url !== openJob.job_url;
      if (!changed) return;
      const { error } = await createClient()
        .from("resume_job")
        .update({ ...next, updated_at: new Date().toISOString() })
        .eq("id", openJob.id);
      if (!error) setJobs((all) => all.map((j) => (j.id === openJob.id ? { ...j, ...next } : j)));
    }, 800);
    return () => clearTimeout(timer);
  }, [openJob, json, parsed.kind, company, jobTitle, jobUrl]);

  /**
   * Starts a generation in the background. The form clears at once so the
   * next job can be pasted while this one runs; the row appears under
   * Generations and opens itself if nothing else is open when it finishes.
   */
  const generate = async () => {
    if (!selectedProfile?.profile || isExample) return;
    if (!jobsEnabled) {
      await generateNow();
      return;
    }
    setGenerating(true);
    const result = await startResumeJob({
      profileId,
      jobDescription,
      company: draftCompany,
      jobTitle: draftTitle,
      jobUrl: draftUrl,
    });
    setGenerating(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    setJobs((all) => [result.job, ...all]);
    setJobDescription("");
    setDraftCompany("");
    setDraftTitle("");
    setDraftUrl("");
    message.success("Generating in the background — paste the next job whenever you like.");
  };

  const retryJob = async (job: ResumeJobRow) => {
    const result = await startResumeJob({
      profileId: job.profile_id,
      jobDescription: job.job_description,
      company: job.company ?? undefined,
      jobTitle: job.job_title ?? undefined,
      jobUrl: job.job_url ?? undefined,
    });
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    await createClient().from("resume_job").delete().eq("id", job.id);
    setJobs((all) => [result.job, ...all.filter((j) => j.id !== job.id)]);
  };

  const deleteJob = async (job: ResumeJobRow) => {
    const { error } = await createClient().from("resume_job").delete().eq("id", job.id);
    if (error) {
      message.error(error.message);
      return;
    }
    setJobs((all) => all.filter((j) => j.id !== job.id));
    if (job.id === openJobId) closeDocument();
  };

  /**
   * The fallback before the database has resume_job: generate in the request
   * and put the answer straight into the editor, as the builder used to.
   */
  const generateNow = async () => {
    setGenerating(true);
    const result = await generateResumeContent({ profileId, jobDescription });
    setGenerating(false);

    if (!result.ok) {
      message.error(result.error);
      return;
    }

    setOpenJobId(null);
    setDocumentId("");
    setJson(result.content);
    setLastRun(result);
    setCompany(draftCompany);
    setJobTitle(draftTitle);
    setJobUrl(draftUrl);
    if (!title.trim()) {
      try {
        const target = JSON.parse(result.content)?.targetTitle;
        if (typeof target === "string" && target.trim()) setTitle(target.trim());
      } catch {
        // A title is a convenience; the content is what matters.
      }
    }
    if (result.valid) message.success("Generated. Review it, then save or download.");
    else message.warning("Generated, but it needs a fix — see the errors under the content.");
  };

  /**
   * Records the application, then downloads the resume with the PDF attached
   * to that row.
   *
   * Recording comes first: the duplicate cooldown and the blocklist are why it
   * might be refused, and that should be known before a resume goes out. A
   * refusal says why and offers the download on its own; tracking is the
   * default, not a gate on getting the file.
   */
  const downloadAndTrack = async () => {
    if (parsed.kind !== "ok") return;
    const doc = parsed.document;
    setTracking(true);
    try {
      const recorded = await recordApplication({
        profileId,
        title: jobTitle.trim() || doc.content.targetTitle,
        company,
        jobUrl,
      });

      const blob = await renderResumePdfBlob(doc, style, template);
      const fileName = resumeFileName(doc);

      if (!recorded.ok) {
        if (recorded.reason === "other") {
          message.error(recorded.error);
          return;
        }
        modal.confirm({
          title: recorded.reason === "cooldown" ? "Already applied recently" : "On the blocklist",
          content: recorded.error,
          okText: "Download without tracking",
          cancelText: "Cancel",
          onOk: () => saveBlob(blob, fileName),
        });
        return;
      }

      saveBlob(blob, fileName);

      try {
        const uploaded = (await startUpload([new File([blob], fileName, { type: "application/pdf" })]))?.[0];
        if (!uploaded) throw new Error("upload refused");
        const attached = await attachApplicationResume({
          applicationId: recorded.id,
          key: uploaded.key,
          url: uploaded.ufsUrl,
          name: uploaded.name,
        });
        if (!attached.ok) throw new Error(attached.error);
        message.success("Downloaded, and tracked in Applications with the PDF attached.");
      } catch {
        message.warning("Downloaded and tracked in Applications, but the PDF couldn't be attached to it.");
      }
      if (openJob) {
        // The generation keeps its fields, now marked as sent.
        await createClient()
          .from("resume_job")
          .update({ application_id: recorded.id, updated_at: new Date().toISOString() })
          .eq("id", openJob.id);
        setJobs((all) => all.map((j) => (j.id === openJob.id ? { ...j, application_id: recorded.id } : j)));
      } else {
        setCompany("");
        setJobTitle("");
        setJobUrl("");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Couldn't download the resume.");
    } finally {
      setTracking(false);
    }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    const key = answerKey;
    const result = await askFollowUp({
      profileId,
      // The open generation's own job; otherwise whatever is in the job box.
      jobDescription: openJob?.job_description ?? jobDescription,
      resume: json,
      question,
      history: answers.map(({ question, answer }) => ({ question, answer })),
    });
    setAsking(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    setAnswersByKey((all) => ({
      ...all,
      [key]: [
        ...(all[key] ?? []),
        { question: question.trim(), answer: result.answer, costUsd: result.costUsd, latencyMs: result.latencyMs },
      ],
    }));
    setQuestion("");
  };

  const canGenerate =
    generation.enabled &&
    !isExample &&
    !reviewOnly &&
    Boolean(selectedProfile?.profile) &&
    jobDescription.trim().length > 0;

  return (
    <>
      <Space
        style={{
          marginBottom: 16,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Resume builder
          </Typography.Title>
          <Typography.Text type="secondary">
            Identity comes from the profile. Add the job, generate the tailored
            content — or paste your own — then style and download.
          </Typography.Text>
        </div>
        <Space>
          <Tooltip
            title={
              reviewOnly && !isExample
                ? "Review only. Assign this profile to yourself on the Profiles page to work it."
                : isExample
                  ? "The demo profile has no database row to attach a resume to."
                  : openDocument && !overwrites
                    ? "Someone else wrote this one, so saving files your own copy."
                    : undefined
            }
          >
            <Button
              icon={<SaveOutlined />}
              onClick={save}
              loading={saving}
              disabled={reviewOnly || parsed.kind !== "ok" || isExample}
            >
              {overwrites ? "Save" : "Save as new"}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={download}
            loading={downloading}
            disabled={parsed.kind !== "ok"}
          >
            Download PDF
          </Button>
        </Space>
      </Space>

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={10}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <StepCard number={1} title="Candidate">
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Profile
                </Typography.Text>
                <Select
                  style={{ width: "100%" }}
                  value={profileId || undefined}
                  onChange={pickProfile}
                  placeholder="Choose a candidate"
                  options={((): DefaultOptionType[] => {
                    const option = (p: ProfileOption) => ({
                      value: p.id,
                      label: p.error ? `${p.fullName} — unreadable` : p.fullName,
                      disabled: Boolean(p.error),
                    });
                    if (!readOnly) return options.map(option);
                    // A super admin sees every team's candidates; the ones
                    // they work come first, the rest are for review.
                    return [
                      { label: "Assigned to you", options: profiles.filter((p) => p.workable).map(option) },
                      { label: "Review only", options: profiles.filter((p) => !p.workable).map(option) },
                      { label: "Demo", options: [option(EXAMPLE_OPTION)] },
                    ].filter((group) => group.options.length);
                  })()}
                />
              </div>

              {!isExample && selectedProfile?.profile && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {selectedProfile.hasCompanyContext
                    ? "Company context is on file and goes into generation."
                    : "No company context on this profile yet — add one on the profile for better-targeted bullets."}
                </Typography.Text>
              )}

              {isExample && (
                <Alert
                  type="info"
                  showIcon
                  title="You're looking at the demo profile"
                  description={
                    profiles.length
                      ? "Pick a real candidate above to build something you can save."
                      : "No candidate has been assigned to you yet. Everything here works — style it, preview it, download the PDF — but saving needs a real profile. Ask an admin to assign one, or create one on the Profiles page."
                  }
                />
              )}

              {selectedProfile?.error && (
                <Alert
                  type="error"
                  showIcon
                  title="This profile can't be used"
                  description={selectedProfile.error}
                />
              )}

              {!isExample && (
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Saved resumes
                    </Typography.Text>
                    <Select
                      style={{ width: "100%" }}
                      value={documentId || undefined}
                      placeholder="New resume"
                      onChange={pickDocument}
                      allowClear
                      onClear={() => pickDocument("")}
                      options={profileDocuments.map((d) => ({
                        value: d.id,
                        label: `${d.title} · ${formatDate(d.updated_at)}`,
                      }))}
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Title, for saving
                    </Typography.Text>
                    <Input
                      placeholder="e.g. “Acme, Staff Engineer”"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </Col>
                </Row>
              )}
            </StepCard>

            <StepCard number={2} title="Job">
              <Segmented<Source>
                block
                value={source}
                onChange={setSource}
                options={[
                  {
                    value: "ai",
                    label: (
                      <span>
                        <RobotOutlined /> Generate with AI
                      </span>
                    ),
                  },
                  {
                    value: "paste",
                    label: (
                      <span>
                        <CodeOutlined /> Paste JSON
                      </span>
                    ),
                  },
                ]}
              />

              {source === "ai" ? (
                <>
                  {!generation.enabled && (
                    <Alert
                      type="warning"
                      showIcon
                      title="AI generation isn't set up yet"
                      description="The super admin needs to finish setting up generation. Until then, use Paste JSON."
                    />
                  )}
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Job description
                    </Typography.Text>
                    <Input.TextArea
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      autoSize={{ minRows: 8, maxRows: 24 }}
                      placeholder="Paste the job posting — title, responsibilities, requirements."
                      disabled={isExample}
                    />
                  </div>
                  <Row gutter={[8, 8]}>
                    <Col xs={24} sm={12}>
                      <Input
                        placeholder="Company (optional)"
                        value={draftCompany}
                        onChange={(e) => setDraftCompany(e.target.value)}
                        disabled={isExample}
                      />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Input
                        placeholder="Job title (optional)"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        disabled={isExample}
                      />
                    </Col>
                    <Col span={24}>
                      <Input
                        placeholder="Job URL (optional) — https://…"
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        disabled={isExample}
                      />
                    </Col>
                  </Row>
                  <Tooltip
                    title={
                      !generation.enabled
                        ? "Generation is off — the super admin needs to set the OpenRouter key."
                        : reviewOnly && !isExample
                          ? "Review only. Assign this profile to yourself on the Profiles page to generate for it."
                          : isExample
                            ? "Pick a real candidate to generate for."
                            : !jobDescription.trim()
                              ? "Paste the job description first."
                              : jobsEnabled && runningCount >= MAX_RUNNING_JOBS
                                ? `${MAX_RUNNING_JOBS} are generating — start the next when one finishes.`
                                : jobsEnabled
                                  ? "Runs in the background. Company, title and URL go with it to Apply."
                                  : json.trim()
                                    ? "Replaces the current content."
                                    : undefined
                    }
                  >
                    <Button
                      type="primary"
                      size="large"
                      block
                      icon={<RobotOutlined />}
                      loading={generating}
                      disabled={!canGenerate || (jobsEnabled && runningCount >= MAX_RUNNING_JOBS)}
                      onClick={generate}
                    >
                      {jobsEnabled
                        ? generating
                          ? "Starting…"
                          : "Generate"
                        : generating
                          ? "Generating…"
                          : "Generate resume"}
                    </Button>
                  </Tooltip>
                  {!jobsEnabled && generation.enabled && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Background generation turns on once the database update (schema
                      part 1) has been run; until then Generate waits for the answer.
                    </Typography.Text>
                  )}
                </>
              ) : (
                <>
                  {employmentIds.length > 0 && (
                    <Alert
                      type="info"
                      title={
                        <Space size={4} wrap>
                          <Typography.Text style={{ fontSize: 12 }}>
                            Pasted content must use these employment ids:
                          </Typography.Text>
                          {employmentIds.map((id) => (
                            <Tag key={id} style={{ margin: 0 }}>
                              {id}
                            </Tag>
                          ))}
                        </Space>
                      }
                    />
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, minWidth: 180 }}>
                      Paste or write the content JSON in step 3.
                    </Typography.Text>
                    <Tooltip title="Fill in the skeleton — employment ids in the right order, ready to edit or paste over">
                      <Button
                        size="small"
                        icon={<ThunderboltOutlined />}
                        disabled={!selectedProfile?.profile}
                        onClick={() => {
                          setOpenJobId(null);
                          startFromProfile();
                        }}
                      >
                        Start from profile
                      </Button>
                    </Tooltip>
                  </div>
                </>
              )}
            </StepCard>

            {jobsEnabled && jobs.length > 0 && (
              <Card
                variant="borderless"
                styles={{ body: { padding: "16px 12px 12px" } }}
                title={
                  <span style={{ fontSize: 14 }}>
                    Generations
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                      {runningCount
                        ? `${runningCount} running · up to ${MAX_RUNNING_JOBS} at once`
                        : "click a ready one to open it"}
                    </Typography.Text>
                  </span>
                }
              >
                <GenerationsList
                  jobs={jobs}
                  openJobId={openJobId}
                  now={now}
                  timedOut={timedOut}
                  profileName={(id) => options.find((p) => p.id === id)?.fullName ?? "Profile"}
                  onOpen={showJob}
                  onRetry={retryJob}
                  onDelete={deleteJob}
                />
              </Card>
            )}

            <StepCard
              number={3}
              title="Content"
              extra={
                openJob || documentId || json.trim() ? (
                  <Button size="small" type="text" icon={<CloseOutlined />} onClick={closeDocument}>
                    Close
                  </Button>
                ) : undefined
              }
            >
              {(openJob || documentId) && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {openJob
                    ? `Generation: ${jobLabel(openJob)} — edits are saved to it as you type.`
                    : "Saved resume — Save writes your changes back to it."}
                  {openJob?.application_id ? " Tracked in Applications." : ""}
                </Typography.Text>
              )}
              {lastRun && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {[
                    lastRun.model,
                    lastRun.tokens ? `${lastRun.tokens.toLocaleString()} tokens` : null,
                    lastRun.costUsd !== null ? `$${lastRun.costUsd.toFixed(4)}` : null,
                    `${(lastRun.latencyMs / 1000).toFixed(1)}s`,
                    lastRun.attempts > 1 ? "1 repair" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography.Text>
              )}
              {json.trim() || source === "paste" ? (
                <Input.TextArea
                  autoSize={{ minRows: 12, maxRows: 48 }}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  placeholder='{ "targetTitle": "…", "summary": "…", "skills": [], "experiences": [] }'
                  style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                />
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {jobsEnabled
                    ? "Generate above, then open a ready generation — its JSON appears here, editable."
                    : "Generate above, or switch to Paste JSON."}
                </Typography.Text>
              )}
            </StepCard>

            <StepCard number={4} title="Check">
              {parsed.kind === "noprofile" && (
                <Alert type="info" showIcon title="Choose a profile to begin." />
              )}
              {parsed.kind === "empty" && (
                <Alert
                  type="info"
                  showIcon
                  title={
                    source === "ai"
                      ? "Paste the job description and press Generate resume."
                      : "Paste content JSON, or press “Start from profile”."
                  }
                  description="Until then the preview shows what the profile already knows — identity, employers and dates."
                />
              )}
              {parsed.kind === "syntax" && (
                <Alert
                  type="error"
                  showIcon
                  title="Not valid JSON"
                  description={parsed.message}
                />
              )}
              {parsed.kind === "idmismatch" && (
                <Alert
                  type="warning"
                  showIcon
                  title="These employment ids aren't on this profile"
                  description={
                    <>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>
                        Your JSON is otherwise fine. Experiences are linked to
                        employers by id, and these don&apos;t resolve:
                      </Typography.Paragraph>
                      <div style={{ marginBottom: 8 }}>
                        {parsed.unknown.map((id) => (
                          <Tag key={id} color="red">
                            {id}
                          </Tag>
                        ))}
                      </div>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>
                        This profile defines:
                      </Typography.Paragraph>
                      <div style={{ marginBottom: 12 }}>
                        {parsed.expected.length ? (
                          parsed.expected.map((id) => (
                            <Tag key={id} color="blue">
                              {id}
                            </Tag>
                          ))
                        ) : (
                          <Typography.Text type="secondary">
                            none — this profile has no employment recorded yet
                          </Typography.Text>
                        )}
                      </div>
                      {parsed.remappable ? (
                        <Tooltip
                          title={orderedEmployments
                            .map((e, i) => `${i + 1}. → ${e.id} (${e.company})`)
                            .join("   ")}
                        >
                          <Button size="small" type="primary" onClick={remapIds}>
                            Remap in order
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Edit the ids above to match, or fix the profile&apos;s
                          employment entries.
                        </Typography.Text>
                      )}
                    </>
                  }
                />
              )}
              {parsed.kind === "invalid" && (
                <Alert
                  type="error"
                  showIcon
                  title="Doesn't match the schema"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {parsed.errors.map((e) => (
                        <li key={`${e.path}-${e.message}`}>
                          <code>{e.path || "(root)"}</code> — {e.message}
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
              {parsed.kind === "ok" && (
                <Alert
                  type="success"
                  showIcon
                  title={`Ready — ${parsed.document.content.targetTitle}`}
                  description={(() => {
                    const { experiences, skills } = parsed.document.content;
                    const bullets = experiences.reduce((n, x) => n + x.bullets.length, 0);
                    return `${experiences.length} role${experiences.length === 1 ? "" : "s"} · ${bullets} bullet${bullets === 1 ? "" : "s"} · ${skills.length} skill group${skills.length === 1 ? "" : "s"}. Check the preview, then save or download.`;
                  })()}
                />
              )}

            </StepCard>

            {parsed.kind === "ok" && !isExample && (
              <>
                <StepCard number={5} title="Apply">
                  <Row gutter={[8, 8]}>
                    <Col xs={24} sm={12}>
                      <Input
                        placeholder="Company"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        disabled={reviewOnly}
                      />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Input
                        placeholder={`Job title — ${parsed.document.content.targetTitle}`}
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        disabled={reviewOnly}
                      />
                    </Col>
                  </Row>
                  <Input
                    placeholder="Job URL — https://…"
                    value={jobUrl}
                    onChange={(e) => setJobUrl(e.target.value)}
                    disabled={reviewOnly}
                  />
                  <Tooltip
                    title={
                      reviewOnly
                        ? "Review only. Assign this profile to yourself on the Profiles page to track for it."
                        : !company.trim() || !jobUrl.trim()
                          ? "Enter the company and job URL to track it."
                          : "Downloads the PDF and adds it to Applications, with the file attached."
                    }
                  >
                    <Button
                      type="primary"
                      block
                      icon={<DownloadOutlined />}
                      loading={tracking}
                      disabled={reviewOnly || !company.trim() || !jobUrl.trim()}
                      onClick={downloadAndTrack}
                    >
                      Download &amp; track
                    </Button>
                  </Tooltip>

                </StepCard>

                <StepCard number={6} title="Follow-up questions">
                  <Input.TextArea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder="e.g. “Why do you want to work here?” or “Describe a hard production problem you solved.”"
                    disabled={!generation.enabled || reviewOnly}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      icon={<SendOutlined />}
                      loading={asking}
                      disabled={!generation.enabled || reviewOnly || !question.trim()}
                      onClick={ask}
                    >
                      Ask
                    </Button>
                  </div>
                  {answers.map((a, i) => (
                    <Card
                      key={i}
                      size="small"
                      title={<span style={{ fontSize: 13, whiteSpace: "normal" }}>{a.question}</span>}
                      extra={
                        <Button
                          size="small"
                          type="text"
                          icon={<CopyOutlined />}
                          onClick={() => {
                            navigator.clipboard.writeText(a.answer);
                            message.success("Answer copied.");
                          }}
                        >
                          Copy
                        </Button>
                      }
                    >
                      <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 4 }}>
                        {a.answer}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {a.costUsd !== null ? `$${a.costUsd.toFixed(4)} · ` : ""}
                        {(a.latencyMs / 1000).toFixed(1)}s
                      </Typography.Text>
                    </Card>
                  ))}
                </StepCard>
              </>
            )}
          </div>
        </Col>

        <Col xs={24} lg={14} style={{ position: "sticky", top: STICKY_TOP }}>
          {/*
            Pinned beside the steps at the viewport's height: the style controls
            on top, the PDF filling the rest. The PDF viewer scrolls itself.
          */}
          <div
            style={{
              height: `calc(100dvh - ${STICKY_TOP + 16}px)`,
              minHeight: 520,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <ResumeStyleToolbar
              template={template}
              style={style}
              templates={templates}
              accents={accents}
              onTemplateChange={setTemplate}
              onStyleChange={setStyle}
            />
            <Card
              title="Preview"
              variant="borderless"
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
              extra={
                parsed.kind === "ok" && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {template} · {style.accent ?? "slate"} ·{" "}
                    {style.fontScale ?? 100}%
                  </Typography.Text>
                )
              }
              styles={{
                body: {
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  // The sheet reads as paper against the dashboard's grey.
                  background: "#f1f4f9",
                  padding: 16,
                },
              }}
            >
              {parsed.kind === "ok" ? (
                previewUrl ? (
                  <iframe
                    // Keyed on the URL so the viewer reloads rather than caching
                    // the previous document.
                    key={previewUrl}
                    src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
                    title="Resume preview"
                    style={{ width: "100%", height: "100%", border: 0 }}
                  />
                ) : (
                  <div
                    style={{ height: "100%", display: "grid", placeItems: "center" }}
                  >
                    <Spin description="Rendering…" />
                  </div>
                )
              ) : selectedProfile?.profile ? (
                /*
                 * Identity and employment history come from the profile, so they
                 * can be shown the moment one is picked. Waiting for valid
                 * content to render anything at all made a correctly-working page
                 * look broken — you pick a candidate and stare at an empty box.
                 */
                <ProfileOnlyPreview
                  profile={selectedProfile.profile}
                  style={style}
                />
              ) : (
                <div
                  style={{ height: "100%", display: "grid", placeItems: "center" }}
                >
                  <Empty description="Choose a profile to see it here." />
                </div>
              )}
            </Card>
          </div>
        </Col>
      </Row>
    </>
  );
}

const SHEET: React.CSSProperties = {
  background: "#fff",
  padding: "24px 28px",
  border: "1px solid #eef0f2",
  borderRadius: 6,
};

/**
 * The resume before any content exists: everything the profile already knows.
 *
 * The greyed placeholders are the shape of what's missing, which is more useful
 * than a blank panel — you can see at a glance that the identity and dates are
 * right before spending a model call on the positioning.
 */
function ProfileOnlyPreview({
  profile,
  style,
}: {
  profile: ResumeProfile;
  style: ResumeStyle;
}) {
  const employments = [...profile.employments].sort(
    (a, b) => monthYearKey(b.startDate) - monthYearKey(a.startDate),
  );

  return (
    <div style={SHEET}>
      <Typography.Title level={4} style={{ marginBottom: 0 }}>
        {profile.fullName}
      </Typography.Title>
      <Typography.Text type="secondary" italic>
        Target role — from your content JSON
      </Typography.Text>

      <div style={{ marginTop: 4 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {/* Same builder the PDF uses, so the header settings behave
              identically here and in the rendered document. */}
          {headerSegments(profile.contact, resolveHeaderFields(style.header))
            .map((s) => s.text)
            .join("  ·  ")}
        </Typography.Text>
      </div>

      <Divider style={{ margin: "12px 0" }} />
      <Typography.Paragraph type="secondary" italic style={{ marginBottom: 8 }}>
        Summary, skills and bullet points come from the content JSON on the
        left. Everything below is already on file.
      </Typography.Paragraph>

      {employments.length > 0 && (
        <>
          <Typography.Text strong>Experience</Typography.Text>
          {employments.map((e) => (
            <div key={e.id} style={{ margin: "8px 0 12px" }}>
              <Typography.Text>{e.company}</Typography.Text>
              <Tag style={{ marginLeft: 6 }}>{e.id}</Tag>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {e.location ? `${e.location} · ` : ""}
                  {formatMonthYear(e.startDate)} –{" "}
                  {formatMonthYear(e.endDate ?? null, "Present")}
                </Typography.Text>
              </div>
            </div>
          ))}
        </>
      )}

      {profile.education.length > 0 && (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Typography.Text strong>Education</Typography.Text>
          {profile.education.map((e) => (
            <div key={`${e.school}-${e.degree}`} style={{ marginTop: 6 }}>
              <Typography.Text>{e.degree}</Typography.Text>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {e.school}
                  {e.year ? ` · ${formatMonthYear(e.year)}` : ""}
                </Typography.Text>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * A numbered section heading in the left panel: the page reads as three steps
 * — who, for what job, with what content — which is the order they are done in.
 */
/**
 * One step of the flow, as its own card. Cards rather than dividers in one
 * long panel: each step reads as a unit, and the page — not a box inside it —
 * is what scrolls.
 */
function StepCard({
  number,
  title,
  extra,
  children,
}: {
  number: number;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <Card variant="borderless" styles={{ body: { padding: 20 } }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 600,
            color: "#4f46e5",
            background: "#eef0ff",
          }}
        >
          {number}
        </span>
        <Typography.Text strong style={{ fontSize: 14, flex: 1 }}>
          {title}
        </Typography.Text>
        {extra}
      </div>
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        {children}
      </Space>
    </Card>
  );
}

/** A generation's name: its title — given, or the model's — and company. */
function jobLabel(job: ResumeJobRow, withCompany = true): string {
  const target =
    job.content && typeof job.content === "object" && "targetTitle" in job.content
      ? String((job.content as { targetTitle: unknown }).targetTitle ?? "")
      : "";
  const firstLine = job.job_description.split("\n").find((l) => l.trim())?.trim().slice(0, 60) ?? "Job";
  const title = job.job_title?.trim() || target.trim() || firstLine;
  return withCompany && job.company ? `${title} · ${job.company}` : title;
}

/**
 * Your recent generations, one row each: running with a clock, ready to
 * open, or failed with the reason and a retry. The open one is highlighted.
 */
function GenerationsList({
  jobs,
  openJobId,
  now,
  timedOut,
  profileName,
  onOpen,
  onRetry,
  onDelete,
}: {
  jobs: ResumeJobRow[];
  openJobId: string | null;
  now: number;
  timedOut: (job: ResumeJobRow) => boolean;
  profileName: (id: string) => string;
  onOpen: (job: ResumeJobRow) => void;
  onRetry: (job: ResumeJobRow) => void;
  onDelete: (job: ResumeJobRow) => void;
}) {
  return (
    <div role="list" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {jobs.map((job) => {
        const stale = timedOut(job);
        const running = job.status === "running" && !stale;
        const failed = job.status === "failed" || stale;
        const ready = job.status === "ready";
        const open = job.id === openJobId;
        const elapsed = now ? Math.max(0, Math.round((now - Date.parse(job.created_at)) / 1000)) : null;

        const icon = running ? (
          <LoadingOutlined style={{ color: "#4f46e5" }} />
        ) : failed ? (
          <CloseCircleFilled style={{ color: "#dc2626" }} />
        ) : job.valid ? (
          <CheckCircleFilled style={{ color: "#16a34a" }} />
        ) : (
          <ExclamationCircleFilled style={{ color: "#d97706" }} />
        );

        const detail = running
          ? `Generating…${elapsed !== null ? ` ${elapsed}s` : ""}`
          : stale
            ? "Timed out — retry it"
            : failed
              ? (job.error ?? "Failed")
              : [
                  job.valid ? null : "Needs a fix",
                  job.cost_usd !== null ? `$${Number(job.cost_usd).toFixed(4)}` : null,
                  job.latency_ms ? `${Math.round(job.latency_ms / 1000)}s` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");

        return (
          <div
            key={job.id}
            role="listitem"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 10,
              background: open ? "#eef0ff" : "transparent",
              boxShadow: open ? "inset 3px 0 0 #4f46e5" : undefined,
            }}
          >
            <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
              {icon}
            </span>
            <div
              role={ready ? "button" : undefined}
              tabIndex={ready ? 0 : undefined}
              aria-label={ready ? `Open ${jobLabel(job)}` : undefined}
              onClick={() => ready && onOpen(job)}
              onKeyDown={(e) => {
                if (ready && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onOpen(job);
                }
              }}
              style={{ flex: 1, minWidth: 0, cursor: ready ? "pointer" : "default" }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#0f172a",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {jobLabel(job)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: failed ? "#b91c1c" : "#64748b",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={failed ? (job.error ?? undefined) : undefined}
              >
                {profileName(job.profile_id)} · {detail}
              </div>
            </div>
            {job.application_id && (
              <Tag color="green" bordered={false} style={{ margin: 0 }}>
                Tracked
              </Tag>
            )}
            {failed && (
              <Tooltip title="Run it again with the same job">
                <Button size="small" type="text" icon={<RedoOutlined />} aria-label="Retry" onClick={() => onRetry(job)} />
              </Tooltip>
            )}
            {!running && (
              <Tooltip title="Remove from the list">
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label="Remove"
                  onClick={() => onDelete(job)}
                />
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
