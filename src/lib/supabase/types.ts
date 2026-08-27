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
  | "ssn_encrypted";

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
