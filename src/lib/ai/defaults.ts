/**
 * What generation uses until the super admin chooses otherwise. Mirrored by
 * the column defaults on generation_setting in 01_tables.sql.
 *
 * Client-safe on purpose: the settings and lab pages show these as the
 * fallback, so they must not drift from what the server sends.
 */
export const DEFAULT_MODEL = "openai/gpt-6-luna";

/** Leave reasoning to the model. See reasoningParam() for the alternatives. */
export const DEFAULT_REASONING = "default";
