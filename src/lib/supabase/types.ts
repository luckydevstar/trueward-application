import type { ResumeContent, ResumeProfile } from "@/lib/document/schema";
import type { HeaderFields } from "@/lib/resume-header";
import type { UserRole } from "@/lib/roles";
import type { ApplicationStatus, BillingStatus } from "@/lib/status";

/**
 * Hand-written to match supabase/migrations/0001_init.sql.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts
 *
 * The generated version is authoritative for column shape, but it types every
 * jsonb column as `Json`. The two that matter here — candidate_profile.profile
 * and resume_document.content — are typed as their zod-inferred shapes instead,
 * which is what lets the builder read a document without casting. Keep those
 * two overrides if you regenerate.
 */

type Timestamps = {
  created_at: string;
  updated_at: string;
};

type Owned = {
  team_id: string;
  created_by: string | null;
};

export type AppUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  created_by_id: string | null;
  /**
   * Which resume templates and accents this account may use. Null falls back
   * to the role default; see src/lib/style-access.ts.
   */
  allowed_templates: string[] | null;
  allowed_accents: string[] | null;
  /** May open Trueward Finance (read-only). The super admin always may. */
  finance_access: boolean;
  created_at: string;
};

export type CandidateProfileRow = Owned &
  Timestamps & {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
    /** ISO date. Never enters the derived `profile` payload. */
    birthday: string | null;
    github_url: string | null;
    linkedin_url: string | null;
    /**
     * What each employer does — business model, products, customers — as the
     * profile adder recorded it. Sent with generation; never rendered.
     */
    company_context: string | null;
    /**
     * pgp_sym_encrypt ciphertext, surfaced by PostgREST as a hex string.
     *
     * Only ever selected to test it against null — "is an SSN on file?" — and
     * never sent to the browser. Reading the plaintext goes through the
     * revealSsn server action, which holds the key and writes an audit entry;
     * writing goes through setSsn. Neither path touches this column directly
     * from client code.
     */
    ssn_encrypted: string | null;
    /** Derived from the columns above — see src/lib/profile.ts. */
    profile: ResumeProfile;
  };

export type ProfileAssignmentRow = {
  id: string;
  profile_id: string;
  user_id: string;
  team_id: string;
  assigned_by: string | null;
  created_at: string;
};

export type ProfileAttachmentRow = Owned & {
  id: string;
  profile_id: string;
  label: string;
  file_key: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
};

export type SsnAccessLogRow = {
  id: string;
  profile_id: string;
  actor_id: string | null;
  team_id: string;
  revealed_at: string;
};

export type ResumeStyle = {
  fontScale?: number;
  headerPosition?: "left" | "center";
  accent?: string;
  lineSpacing?: number;
  /** Stretch body copy to the full measure, last line of each block excepted. */
  justify?: boolean;
  /** Typeface id from src/lib/pdf/fonts.ts; unset means the template's own. */
  font?: string;
  /**
   * Which contact details print in the header. Partial — anything unset falls
   * back to HEADER_DEFAULTS in src/lib/resume-header.ts.
   */
  header?: Partial<HeaderFields>;
};

export type ResumeDocumentRow = Owned &
  Timestamps & {
    id: string;
    title: string;
    profile_id: string;
    content: ResumeContent;
    template: string;
    style: ResumeStyle;
  };

export type BlockedCompanyRow = Owned & {
  id: string;
  name: string;
  normalized_name: string;
  created_at: string;
};

export type ApplicationRow = Owned &
  Timestamps & {
    id: string;
    title: string;
    company: string;
    job_url: string;
    status: ApplicationStatus;
    billing: BillingStatus;
    notes: string | null;
    /** Resume attached to this application, uploaded from its grid cell. */
    resume_key: string | null;
    resume_url: string | null;
    resume_name: string | null;
    resume_document_id: string | null;
    profile_id: string | null;
    applied_at: string;
    /** Null while active. A timestamp takes it off the working list. */
    archived_at: string | null;
    /** A007-2 is no 7, part 2 — assigned by the database, see lib/numbers.ts. */
    no: number;
    no_part: number;
    /** The job it was made from; its description lives there. */
    job_id: string | null;
  };

/** The one row of resume-generation settings — see 01_tables.sql. */
export type GenerationSettingRow = {
  id: boolean;
  system_prompt: string;
  /** An OpenRouter model id. */
  model: string;
  /** "lowest" | "default" | an effort name — see src/lib/ai/models.ts. */
  reasoning: string;
  /** The library prompt every Generate uses; null means the built-in one. */
  active_prompt_id: string | null;
  /** The research prompt profile adders copy; null means the built-in one. */
  active_research_prompt_id: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type PromptKind = "resume" | "research";

/**
 * A prompt in the super admin's library: a resume base prompt, or a company
 * research prompt for profile adders.
 */
export type GenerationPromptRow = {
  id: string;
  name: string;
  body: string;
  kind: PromptKind;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A background generation, and the draft application it becomes. */
export type ResumeJobRow = {
  id: string;
  profile_id: string;
  team_id: string;
  created_by: string;
  status: "queued" | "running" | "ready" | "failed";
  /** The job it was made for, which holds the description, title, company and URL. */
  job_id: string;
  content: unknown;
  valid: boolean | null;
  error: string | null;
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  application_id: string | null;
  /** The style its PDF is rendered in on the server; null means Banner. */
  template: string | null;
  style: ResumeStyle | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

/** A posting someone applies to — the only copy of its description. */
export type JobRow = {
  id: string;
  /** J007 is 7 — assigned by the database, shared with applications. */
  no: number;
  created_by: string | null;
  title: string;
  company: string | null;
  url: string | null;
  description: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** One generation, written by the server for the per-model averages. */
export type ResumeGenerationRow = {
  id: string;
  profile_id: string | null;
  team_id: string;
  created_by: string | null;
  model: string;
  attempts: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  ok: boolean;
  error: string | null;
  /** "builder" for real resumes, "lab" for model-lab tests. */
  source: string;
  /** Groups one lab run's models. */
  run_id: string | null;
  reasoning: string | null;
  /** Which prompt a lab run used: "saved" or "custom". */
  prompt_label: string | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  /** The lab's parsed answer; null for builder rows. */
  output: unknown;
  created_at: string;
};

/**
 * `Insert` drops the database-defaulted columns; `Update` makes everything
 * optional. Written as helpers rather than spelled out per table so a column
 * added to a Row can't be forgotten in the other two.
 */
type Defaulted =
  | "allowed_templates"
  | "allowed_accents"
  | "id"
  | "created_at"
  | "updated_at"
  | "revealed_at"
  // Nothing is created archived, so an insert never carries it.
  | "archived_at"
  // Written only by store_ssn, never as part of a profile insert.
  | "ssn_encrypted"
  // Optional on insert; the profile form sends it when filled.
  | "company_context"
  // Columns the database defaults on the generation tables.
  | "active_prompt_id"
  | "active_research_prompt_id"
  | "kind"
  | "source"
  | "run_id"
  | "reasoning"
  | "prompt_label"
  | "cached_tokens"
  | "reasoning_tokens"
  | "output"
  | "attempts"
  // Off until the super admin grants it.
  | "finance_access"
  // Numbers the database assigns.
  | "no"
  | "no_part"
  | "job_id";

type Insert<T> = Omit<T, Defaulted & keyof T> &
  Partial<Pick<T, Defaulted & keyof T>>;

type Table<Row, Ins = Insert<Row>> = {
  Row: Row;
  Insert: Ins;
  Update: Partial<Ins>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      app_user: Table<AppUserRow>;
      candidate_profile: Table<CandidateProfileRow>;
      profile_assignment: Table<ProfileAssignmentRow>;
      profile_attachment: Table<ProfileAttachmentRow>;
      ssn_access_log: Table<SsnAccessLogRow>;
      resume_document: Table<ResumeDocumentRow>;
      blocked_company: Table<BlockedCompanyRow>;
      application: Table<ApplicationRow>;
      generation_setting: Table<GenerationSettingRow>;
      generation_prompt: Table<GenerationPromptRow>;
      resume_generation: Table<ResumeGenerationRow>;
      job: Table<JobRow, Pick<JobRow, "created_by" | "title" | "description"> & Partial<JobRow>>;
      resume_queue_setting: Table<{ id: boolean; endpoint: string; last_run_at: string | null }>;
      resume_job: Table<
        ResumeJobRow,
        Pick<ResumeJobRow, "profile_id" | "team_id" | "created_by" | "job_id"> &
          Partial<Omit<ResumeJobRow, "profile_id" | "team_id" | "created_by" | "job_id">>
      >;
    };
    Views: {
      /**
       * Derived from recent applications — one row per (profile, company) still
       * inside the cooldown window. security_invoker, so the caller's own
       * application and profile policies decide what they see.
       */
      application_cooldown: {
        Row: {
          profile_id: string;
          profile_name: string;
          company: string;
          applied_at: string;
          reopens_at: string;
          created_by: string | null;
          team_id: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      app_role: { Args: Record<never, never>; Returns: UserRole };
      app_team_id: { Args: Record<never, never>; Returns: string | null };
      can_use_profile: { Args: { target: string }; Returns: boolean };
      /** Moves a profile and everything attached to it to another team. */
      assign_profile_to_team: {
        Args: { target_profile: string; target_team: string };
        Returns: undefined;
      };
      /** Moves a whole team to another subadmin, before the old one is deleted. */
      transfer_team: {
        Args: { from_team: string; to_team: string };
        Returns: undefined;
      };
      /** Service-role only — see supabase/migrations/0002. */
      reveal_ssn: { Args: { target: string; key: string }; Returns: string | null };
      store_ssn: {
        Args: { target: string; plain: string; key: string };
        Returns: undefined;
      };
    };
    Enums: {
      user_role: UserRole;
      application_status: ApplicationStatus;
      billing_status: BillingStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
