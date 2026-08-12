/**
 * Clases compartidas del recorrido del Firmante.
 * Superficie marfil, texto carbón y acento cálido, sin personalización
 * por Organización y sin depender del kit del portal.
 */

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#CA8A04]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAFAF9]";

const ACTION_BASE =
  "inline-flex min-h-[54px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-6 text-center text-base font-semibold transition-colors duration-200 " +
  FOCUS_RING;

export const PRIMARY_ACTION =
  `${ACTION_BASE} bg-[#CA8A04] text-[#1C1917] hover:bg-[#A16207] hover:text-[#FAFAF9]`;

export const SECONDARY_ACTION =
  `${ACTION_BASE} border-2 border-[#1C1917] bg-transparent text-[#1C1917] hover:bg-[#1C1917] hover:text-[#FAFAF9]`;

export const QUIET_ACTION =
  `${ACTION_BASE} min-h-[48px] border border-[#D6D3D1] bg-white text-[#44403C] hover:border-[#1C1917] hover:text-[#1C1917]`;

export const DISABLED_ACTION =
  "inline-flex min-h-[54px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-[#E7E5E4] px-6 text-center text-base font-semibold text-[#78716C]";

export const CARD =
  "rounded-2xl border border-[#E7E5E4] bg-white p-5 shadow-[0_4px_6px_rgba(0,0,0,0.06)] sm:p-6";

export const MUTED = "text-sm leading-relaxed text-[#44403C]";

export const TINY = "text-xs leading-relaxed text-[#57534E]";

export const HEADING =
  "font-display text-2xl leading-tight font-semibold text-[#0C0A09] sm:text-3xl";

export const SUBHEADING =
  "font-display text-xl leading-tight font-semibold text-[#0C0A09]";

/** Tipografía del texto jurídico renderizado desde Markdown. */
export const PROSE = [
  "text-[15px] leading-7 text-[#1C1917] sm:text-base sm:leading-8",
  "[&_p]:mb-4",
  "[&_h2]:font-display [&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[#0C0A09]",
  "[&_h3]:font-display [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#0C0A09]",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-[#0C0A09]",
  "[&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:text-base [&_h5]:font-semibold",
  "[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:mb-1",
  "[&_strong]:font-semibold",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#CA8A04] [&_blockquote]:pl-4 [&_blockquote]:text-[#44403C]",
  "[&_code]:rounded [&_code]:bg-[#F5F5F4] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm",
].join(" ");
