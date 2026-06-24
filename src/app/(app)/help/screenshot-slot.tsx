import Image from 'next/image'

interface ScreenshotSlotProps {
  name: string
  caption: string
  /**
   * Set true only when a PII-safe capture exists at /public/help/<name>.png.
   * Screenshots are captured ONLY from demo/seed or public (no-data) screens —
   * never from real tenant data. When false, nothing renders (a clean text
   * guide), so the page never shows a half-built "screenshot coming" box.
   */
  available?: boolean
}

export function ScreenshotSlot({ name, caption, available = false }: ScreenshotSlotProps) {
  if (!available) return null
  return (
    <figure className="mt-4 space-y-2">
      <Image
        src={`/help/${name}.png`}
        alt={caption}
        width={900}
        height={506}
        className="w-full rounded-lg border"
      />
      <figcaption className="text-muted-foreground text-xs">{caption}</figcaption>
    </figure>
  )
}
