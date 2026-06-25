'use client'

// CSV import wizard — 3 steps:
//   Step 1: Upload / paste CSV
//   Step 2: Preview detected column mapping (with per-column override dropdowns)
//   Step 3: Confirm + show per-row result summary
//
// CLAUDE.md rule: errors surface via try/catch + toast. The wizard never
// reports "success" when the server returned an error — silent-fail is the
// exact bug class we avoid.

import Link from 'next/link'
import Papa from 'papaparse'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { importCandidatesAction, reindexCandidatesAction, type ImportSummary } from './actions'
import { detectMapping } from './column-map'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'upload' | 'map' | 'result'

type MappingOverride = Record<string, string> // csvHeader → canonical field ('skip' to ignore)

const CANONICAL_FIELDS = [
  { value: 'full_name', label: 'Full name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'location', label: 'Location' },
  { value: 'current_role_title', label: 'Current role' },
  { value: 'current_company', label: 'Current company' },
  { value: 'skip', label: '— Skip this column —' },
] as const

// Example CSV content for the downloadable hint.
const EXAMPLE_CSV = `Full Name,Email,Phone,Location,Current Role,Company
Alexandra Sample,alex@example.com,07700900000,London UK,Senior Engineer,Acme Ltd
Marcus Demo,marcus@example.com,,Manchester UK,Head of Finance,Beta Corp`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportWizard() {
  const [step, setStep] = useState<Step>('upload')
  const [csvText, setCsvText] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<MappingOverride>({})
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [loading, setLoading] = useState(false)

  // ---------------------------------------------------------------------------
  // Step 1 — file/paste handler
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ''
      parseCsv(text)
    }
    reader.readAsText(file)
  }

  function parseCsv(text: string) {
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(), // keep original casing for display
    })

    if (result.errors.length > 0 && result.data.length === 0) {
      toast.error('Could not parse the CSV file. Please check the format and try again.')
      return
    }

    // Partial parse: some rows parsed but others errored. Surface a
    // non-blocking warning so the user knows the import will be incomplete.
    if (result.errors.length > 0 && result.data.length > 0) {
      const skipped = result.errors.length
      toast.warning(
        `${skipped} row${skipped === 1 ? '' : 's'} could not be parsed and ${skipped === 1 ? 'was' : 'were'} skipped.`,
      )
    }

    const rawHeaders = result.meta.fields ?? []
    setCsvText(text)
    setHeaders(rawHeaders)
    setPreviewRows(result.data.slice(0, 3)) // show first 3 rows in preview

    // Auto-detect mapping from headers (normalised to lowercase for alias lookup).
    const detected = detectMapping(rawHeaders)
    // Build override map: header → detected canonical (or 'skip' if unknown).
    const autoMapping: MappingOverride = {}
    for (const header of rawHeaders) {
      const norm = header.trim().toLowerCase()
      // Find which canonical field this header maps to (if any).
      const canonical = Object.entries(detected).find(([, v]) => v === header)?.[0] ?? null
      // Also check the normed key directly against the flat map.
      autoMapping[header] = canonical ?? norm
    }
    setMapping(autoMapping)
    setStep('map')
  }

  // ---------------------------------------------------------------------------
  // Step 2 — mapping override change
  // ---------------------------------------------------------------------------

  function handleMappingChange(header: string, canonical: string) {
    setMapping((prev) => ({ ...prev, [header]: canonical }))
  }

  // ---------------------------------------------------------------------------
  // Step 3 — import
  // ---------------------------------------------------------------------------

  async function handleImport() {
    if (!csvText) return
    setLoading(true)
    try {
      // Apply the user's mapping overrides to the CSV text by re-building
      // the CSV with canonical header names. This ensures the server-side
      // mapRow (which uses HEADER_ALIASES on normalised headers) picks them
      // up correctly regardless of the user's original column names.
      const overriddenCsv = applyMappingOverrides(csvText, mapping)

      const result = await importCandidatesAction(overriddenCsv)

      if (!result.ok) {
        // Surface the server error — never close the wizard on failure.
        toast.error(result.error)
        return
      }

      setSummary(result.summary)
      setStep('result')

      // Partial-failure: report if any rows errored or were skipped.
      if (result.summary.created > 0 && result.summary.errors === 0) {
        toast.success(
          `Import complete: ${result.summary.created} candidate${result.summary.created === 1 ? '' : 's'} created.`,
        )
      } else if (result.summary.created > 0 && result.summary.errors > 0) {
        toast.warning(
          `Import partial: ${result.summary.created} created, ${result.summary.errors} failed — check the summary below.`,
        )
      } else if (result.summary.created === 0) {
        toast.warning('No candidates were created. Check the summary below for details.')
      }
    } catch (err) {
      console.error('Import failed:', err)
      toast.error(err instanceof Error ? err.message : 'Import failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resetWizard() {
    setStep('upload')
    setCsvText('')
    setHeaders([])
    setPreviewRows([])
    setMapping({})
    setSummary(null)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (step === 'upload') {
    return <UploadStep onFileChange={handleFileChange} />
  }

  if (step === 'map') {
    return (
      <MapStep
        headers={headers}
        previewRows={previewRows}
        mapping={mapping}
        onMappingChange={handleMappingChange}
        onBack={resetWizard}
        onConfirm={handleImport}
        loading={loading}
      />
    )
  }

  return <ResultStep summary={summary!} onReset={resetWizard} />
}

// ---------------------------------------------------------------------------
// Step sub-components
// ---------------------------------------------------------------------------

function UploadStep({ onFileChange }: { onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  function downloadExample() {
    const blob = new Blob([EXAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'altus-import-example.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Step 1 of 3 — Upload CSV</CardTitle>
        <CardDescription>
          Upload a CSV file with candidate data. Required column: <strong>Name</strong>. Optional:
          Email, Phone, Location, Current Role, Company.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <input
            id="csv-upload"
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="sr-only"
          />
          <label
            htmlFor="csv-upload"
            className="cursor-pointer text-sm text-gray-600 hover:text-gray-900"
          >
            <span className="font-medium text-blue-600 hover:text-blue-700">Choose a CSV file</span>
            {' '}or drag and drop
          </label>
          <p className="mt-1 text-xs text-gray-500">CSV files only, up to 500 rows</p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Not sure about the format?</span>
          <Button variant="outline" size="sm" type="button" onClick={downloadExample}>
            Download example CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MapStep({
  headers,
  previewRows,
  mapping,
  onMappingChange,
  onBack,
  onConfirm,
  loading,
}: {
  headers: string[]
  previewRows: Record<string, string>[]
  mapping: MappingOverride
  onMappingChange: (header: string, canonical: string) => void
  onBack: () => void
  onConfirm: () => void
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Step 2 of 3 — Map Columns</CardTitle>
        <CardDescription>
          Review how your CSV columns map to Altus fields. Adjust if needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-lg border">
          {headers.map((header) => (
            <div key={header} className="flex items-center gap-4 px-4 py-3">
              <span className="w-1/3 truncate text-sm font-medium" title={header}>
                {header}
              </span>
              <span className="text-muted-foreground text-xs">→</span>
              <div className="flex-1">
                <Select
                  value={mapping[header] ?? 'skip'}
                  onValueChange={(val) => onMappingChange(header, val)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CANONICAL_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>

        {previewRows.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
              Preview (first {previewRows.length} rows)
            </p>
            <div className="overflow-x-auto rounded-lg border text-xs">
              <table className="min-w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {headers.map((h) => (
                        <td key={h} className="max-w-[120px] truncate px-3 py-2">
                          {row[h] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-3">
          <Button variant="outline" type="button" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Importing…' : 'Import candidates'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ResultStep({
  summary,
  onReset,
}: {
  summary: ImportSummary
  onReset: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Step 3 of 3 — Import complete</CardTitle>
        <CardDescription>Here is a summary of what was imported.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.created > 0 && <ReindexNotice />}
        <dl className="divide-y rounded-lg border">
          <div className="flex justify-between px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-semibold text-green-700">{summary.created}</dd>
          </div>
          <div className="flex justify-between px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Skipped (no name)</dt>
            <dd>{summary.skippedNoName}</dd>
          </div>
          <div className="flex justify-between px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Skipped (duplicate email)</dt>
            <dd>{summary.skippedDuplicate}</dd>
          </div>
          {summary.errors > 0 && (
            <div className="flex justify-between px-4 py-3 text-sm">
              <dt className="text-red-700">Errors</dt>
              <dd className="font-semibold text-red-700">{summary.errors}</dd>
            </div>
          )}
          {summary.truncated && (
            <div className="px-4 py-3 text-sm">
              <p className="text-amber-700">
                Your file had {summary.totalInput} rows — only the first 500 were imported. Split
                your file and re-import the remaining rows.
              </p>
            </div>
          )}
        </dl>

        <div className="flex gap-3">
          <Button variant="outline" type="button" onClick={onReset}>
            Import another file
          </Button>
          <Button asChild>
            <Link href="/candidates">View candidates</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Re-index notice — search-indexing delay + on-demand "Re-index now"
// ---------------------------------------------------------------------------

function ReindexNotice() {
  // The import action already fires embedding automatically; this is the
  // reassurance + manual trigger. `started` makes the success state sticky so
  // the recruiter isn't tempted to spam the button (each press re-enqueues the
  // same org-wide sweep, which is harmless but pointless).
  const [isPending, startTransition] = useTransition()
  const [started, setStarted] = useState(false)

  function onReindex() {
    startTransition(async () => {
      const result = await reindexCandidatesAction()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setStarted(true)
      toast.success('Re-indexing started — new candidates will be searchable shortly.')
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-100">
        New candidates appear in search within ~10 minutes — or re-index now to make them
        searchable sooner.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onReindex}
        disabled={isPending || started}
        className="shrink-0 bg-background"
      >
        {isPending ? 'Re-indexing…' : started ? 'Re-indexing started' : 'Re-index now'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper: apply user mapping overrides by rewriting CSV headers
// ---------------------------------------------------------------------------

function applyMappingOverrides(csvText: string, mapping: MappingOverride): string {
  // Re-parse with original headers, then rebuild with canonical names.
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    // Keep original casing so we can look up in the mapping object.
    transformHeader: (h: string) => h.trim(),
  })

  const rawHeaders = parsed.meta.fields ?? []

  // Build the canonical rows. Headers mapped to 'skip' are omitted.
  // Multiple source headers can map to the same canonical name — first wins.
  const seenCanonical = new Set<string>()
  const headerRemap: { from: string; to: string }[] = []
  for (const header of rawHeaders) {
    const canonical = mapping[header]
    if (!canonical || canonical === 'skip') continue
    // Normalise the canonical value to lowercase for mapRow's alias lookup.
    const normCanonical = canonical.trim().toLowerCase()
    if (seenCanonical.has(normCanonical)) continue
    seenCanonical.add(normCanonical)
    headerRemap.push({ from: header, to: normCanonical })
  }

  const remappedRows = parsed.data.map((row) => {
    const out: Record<string, string> = {}
    for (const { from, to } of headerRemap) {
      const val = row[from]
      if (val !== undefined) out[to] = val
    }
    return out
  })

  // Pass an explicit columns array from the canonical mapped field set.
  // Without this, PapaParse infers output columns from Object.keys of the
  // FIRST row — a ragged/short first row (e.g. missing a trailing email cell)
  // would silently drop that column for ALL rows, defeating dedup downstream.
  return Papa.unparse(remappedRows, { columns: headerRemap.map((h) => h.to) })
}
