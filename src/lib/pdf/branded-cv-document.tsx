// The one standard, tenant-branded CV template (BCV-02). Two non-obvious
// constraints baked into this file — read before changing anything:
//
// 1. The header sits on a WHITE / very light background, never a full-bleed
//    coloured band. The anchor customer's real logo (Steele Charles) is a
//    wide, NON-TRANSPARENT lockup on white — a solid brand_primary header
//    would frame it in an ugly white box. See 08-CONTEXT.md's "Anchor-
//    customer logo intel" section for the source of this constraint.
// 2. Props are typed `BrandedCvData` (never a raw `candidates` row, never
//    `unknown` widened back out). That is what makes BCV-03's "no email,
//    phone or salary on this document" guarantee a COMPILE-TIME property
//    rather than a review discipline — this file physically cannot
//    reference a field that does not exist on `BrandedCvData`. Do not widen
//    this prop type.
//
// NO `import 'server-only'` here: tests/unit/lib/pdf/branded-cv-document.test.ts
// imports this module directly under `@vitest-environment node` (mirrors the
// same constraint already documented in register-fonts.ts). This file also
// never fetches anything, never touches the database, and never imports
// from `@/lib/supabase`, `@/lib/db`, or `next/*` — it is a pure function of
// its two arguments (data, branding) → PDF bytes.

import './register-fonts' // side effect: registers BRANDED_CV_FONT_FAMILY before any render happens

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

import { BRAND_DEFAULTS, safeHex } from '@/lib/branding/colours'
import type { BrandedCvData } from '@/lib/pdf/branded-cv-data'
import { BRANDED_CV_FONT_FAMILY } from '@/lib/pdf/register-fonts'

// The branding contract THIS file defines; 08-07 (the delivery/generation
// Server Action) must satisfy it. `logo` is BYTES by design — the renderer
// must never fetch a URL (SSRF + the cold-start font-download race documented
// in 08-RESEARCH.md Pitfall 4). The caller downloads the object from the
// private `org-logos` bucket under the tenant's own client and hands us the
// bytes directly.
export type BrandedCvBranding = {
  orgName: string
  primary: string | null // raw DB value; safeHex'd below, never trusted directly
  secondary: string | null // raw DB value; safeHex'd below, never trusted directly
  logo: { data: Uint8Array; format: 'png' | 'jpeg' } | null
}

// react-pdf's own SourceDataBuffer type spells the JPEG format 'jpg', not
// 'jpeg' — translate at this boundary so BrandedCvBranding can use the more
// conventional 'jpeg' spelling without leaking react-pdf's naming outward.
function toReactPdfImageFormat(format: 'png' | 'jpeg'): 'png' | 'jpg' {
  return format === 'jpeg' ? 'jpg' : 'png'
}

// A low-opacity tint of `secondaryColor` for the skill-chip background
// (criterion 5: "brand_secondary for one secondary accent ... at low
// opacity"). react-pdf's colour parser (color-string) supports 8-digit
// #RRGGBBAA hex, so appending an alpha byte to an already-validated 6-digit
// hex is a safe, dependency-free way to get an alpha tint. 0x26 = 38/255 ≈
// 15% opacity — visible as a tint, never reads as a filled colour block.
const SKILL_CHIP_TINT_ALPHA_HEX = '26'

function withAlpha(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`
}

/**
 * Joins the present, non-empty, trimmed parts of the identity context line
 * with a middot separator (criterion 6: "a sparse candidate produces a
 * clean line rather than dangling separators").
 */
function joinContextParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('  ·  ')
}

function formatYearsExperience(years: number | null): string | null {
  if (years === null) return null
  return `${years} yr${years === 1 ? '' : 's'} experience`
}

/**
 * Work/education entries are shaped `{ primary, secondary, dates }` at
 * source (title/company or school/degree) with the mapper's guarantee that
 * at least one field is non-empty (branded-cv-data.ts drops all-blank
 * entries). Renders a bold title line plus a lighter meta line, degrading
 * gracefully when only one or two of the three fields are present.
 */
function formatEntryLines(
  primary: string,
  secondary: string,
  dates: string,
): { titleText: string; metaText: string } {
  const titleText = primary || secondary || dates
  const metaParts: string[] = []
  if (primary && secondary) metaParts.push(secondary)
  if (dates && titleText !== dates) metaParts.push(dates)
  return { titleText, metaText: metaParts.join('  ·  ') }
}

// Style blocks are commented with the numbered visual-acceptance criterion
// (08-04-PLAN.md <objective>) they implement, so a reviewer can check the
// design against the spec without archaeology.
const styles = StyleSheet.create({
  // Criterion 1: A4 portrait, ~40pt margins, single column, ~10pt body.
  page: {
    fontFamily: BRANDED_CV_FONT_FAMILY,
    fontSize: 10,
    lineHeight: 1.4,
    color: '#1A1A1A',
    paddingTop: 40,
    paddingBottom: 64, // extra room for the fixed footer block
    paddingHorizontal: 40,
  },

  // Criterion 2/3: header on a WHITE area (no backgroundColor set — the
  // page background is already white), reserving a wide, landscape logo
  // slot (~160x54pt) with objectFit: 'contain' so a 3:2 lockup renders at
  // natural proportions without stretching, and a square mark still fits.
  header: {
    height: 54,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  logoImage: {
    width: 160,
    height: 54,
    objectFit: 'contain',
  },
  // Criterion 4: deliberate no-logo fallback — the org name as a wordmark
  // in brand_primary, same position/weight, so the header reads as
  // designed rather than empty.
  logoWordmark: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Criterion 5: brand_primary on ACCENTS ONLY — the header rule is one of
  // exactly two full-width coloured lines on the page (the other is the
  // footer rule below). A single 1.5pt rule, not a filled band.
  headerRule: {
    borderBottomWidth: 1.5,
    marginTop: 10,
    marginBottom: 18,
  },

  // Criterion 6: identity header — name, then headline, then the context
  // line (current role · company · seniority · years · location).
  identity: {
    marginBottom: 16,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111111',
  },
  headline: {
    fontSize: 12,
    color: '#333333',
    marginTop: 4,
  },
  contextLine: {
    fontSize: 9.5,
    color: '#555555',
    marginTop: 4,
  },

  // Criterion 6: sections, each omitted entirely when empty (see the
  // component body's conditional rendering — never an empty heading here).
  section: {
    marginBottom: 14,
  },
  // Criterion 1/5: ~11pt bold, brand_primary accent colour, small-caps-ish
  // tracking via uppercase + letterSpacing (react-pdf has no true
  // font-variant: small-caps support).
  sectionHeading: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 10,
    color: '#1A1A1A',
  },

  // Criterion 5: skill chips — brand_primary border/text, brand_secondary
  // low-opacity background tint. Never a large filled colour area.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    fontSize: 9,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 6,
  },
  sectorLine: {
    fontSize: 9,
    color: '#555555',
    marginTop: 2,
  },

  // Criterion 6: work/education entries — each wrapped `wrap={false}` by
  // the caller so a single entry never splits across a page break.
  entry: {
    marginBottom: 8,
  },
  entryTitle: {
    fontSize: 10.5,
    fontWeight: 'bold',
    color: '#111111',
  },
  entryMeta: {
    fontSize: 9.5,
    color: '#555555',
    marginTop: 1,
  },

  // Criterion 7: footer on every page (`fixed`), org name left / "Page N of
  // M" right, plus the contact-details-availability line. Criterion 5: the
  // footer rule is the second (and last) brand_primary accent line.
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
  },
  footerRule: {
    borderTopWidth: 1,
    marginBottom: 6,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8.5,
    color: '#555555',
  },
  footerNotice: {
    fontSize: 8,
    color: '#777777',
    marginTop: 3,
  },
})

export function BrandedCvDocument({
  data,
  branding,
}: {
  data: BrandedCvData
  branding: BrandedCvBranding
}) {
  // Criterion 9: colour safety — run both hex values through `safeHex`
  // before use, so a rogue DB value can never reach the renderer (same
  // defence-in-depth the apply page applies).
  const primaryColor = safeHex(branding.primary, BRAND_DEFAULTS.primary)
  const secondaryColor = safeHex(branding.secondary, BRAND_DEFAULTS.secondary)

  const contextLine = joinContextParts([
    data.currentRoleTitle,
    data.currentCompany,
    data.seniorityLevel,
    formatYearsExperience(data.yearsExperience),
    data.location,
  ])

  const hasHeadline = Boolean(data.headline?.trim())
  const hasAbout = Boolean(data.about?.trim())
  const hasSkills = data.skills.length > 0
  const hasSectorTags = data.sectorTags.length > 0
  const hasWork = data.work.length > 0
  const hasEducation = data.education.length > 0

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header — criteria 2/3/4 */}
        <View style={styles.header}>
          {branding.logo ? (
            // This is @react-pdf/renderer's <Image>, not an HTML
            // <img>/next/image: its ImageProps type has no `alt` prop at
            // all (PDF documents have no DOM/accessibility tree for this
            // rule to apply to).
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={{
                data: Buffer.from(branding.logo.data),
                format: toReactPdfImageFormat(branding.logo.format),
              }}
              style={styles.logoImage}
            />
          ) : (
            <Text style={[styles.logoWordmark, { color: primaryColor }]}>{branding.orgName}</Text>
          )}
        </View>
        <View style={[styles.headerRule, { borderBottomColor: primaryColor }]} />

        {/* Identity header — criterion 6 */}
        <View style={styles.identity}>
          <Text style={styles.name}>{data.fullName}</Text>
          {hasHeadline ? <Text style={styles.headline}>{data.headline}</Text> : null}
          {contextLine ? <Text style={styles.contextLine}>{contextLine}</Text> : null}
        </View>

        {/* Profile — criterion 6, omitted entirely when empty */}
        {hasAbout ? (
          <View style={styles.section}>
            <Text style={[styles.sectionHeading, { color: primaryColor }]}>Profile</Text>
            <Text style={styles.bodyText}>{data.about}</Text>
          </View>
        ) : null}

        {/* Skills (+ optional Sectors line) — criterion 5/6 */}
        {hasSkills ? (
          <View style={styles.section}>
            <Text style={[styles.sectionHeading, { color: primaryColor }]}>Skills</Text>
            <View style={styles.chipRow}>
              {data.skills.map((skill) => (
                <Text
                  key={skill}
                  style={[
                    styles.chip,
                    {
                      borderColor: primaryColor,
                      color: primaryColor,
                      backgroundColor: withAlpha(secondaryColor, SKILL_CHIP_TINT_ALPHA_HEX),
                    },
                  ]}
                >
                  {skill}
                </Text>
              ))}
            </View>
            {hasSectorTags ? (
              <Text style={styles.sectorLine}>Sectors: {data.sectorTags.join(', ')}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Experience — criterion 6, each entry wrap={false} */}
        {hasWork ? (
          <View style={styles.section}>
            <Text style={[styles.sectionHeading, { color: primaryColor }]}>Experience</Text>
            {data.work.map((entry, index) => {
              const { titleText, metaText } = formatEntryLines(entry.title, entry.company, entry.dates)
              return (
                <View key={`work-${index}-${entry.title}`} style={styles.entry} wrap={false}>
                  <Text style={styles.entryTitle}>{titleText}</Text>
                  {metaText ? <Text style={styles.entryMeta}>{metaText}</Text> : null}
                </View>
              )
            })}
          </View>
        ) : null}

        {/* Education — criterion 6, each entry wrap={false} */}
        {hasEducation ? (
          <View style={styles.section}>
            <Text style={[styles.sectionHeading, { color: primaryColor }]}>Education</Text>
            {data.education.map((entry, index) => {
              const { titleText, metaText } = formatEntryLines(entry.school, entry.degree, entry.dates)
              return (
                <View key={`edu-${index}-${entry.school}`} style={styles.entry} wrap={false}>
                  <Text style={styles.entryTitle}>{titleText}</Text>
                  {metaText ? <Text style={styles.entryMeta}>{metaText}</Text> : null}
                </View>
              )
            })}
          </View>
        ) : null}

        {/* Footer — criterion 7, fixed on every page */}
        <View style={styles.footer} fixed>
          <View style={[styles.footerRule, { borderTopColor: primaryColor }]} />
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>{branding.orgName}</Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
          <Text style={styles.footerNotice}>
            Candidate contact details available from {branding.orgName}.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

/** Pure render: data + branding → PDF bytes. No database, network or auth concerns. */
export function renderBrandedCv(data: BrandedCvData, branding: BrandedCvBranding): Promise<Buffer> {
  return renderToBuffer(<BrandedCvDocument data={data} branding={branding} />)
}
