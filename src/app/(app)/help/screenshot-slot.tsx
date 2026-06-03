import { ImageOff } from 'lucide-react'

interface ScreenshotSlotProps {
  name: string
  caption: string
}

// TODO(help-screenshots): once PII-safe captures exist in /public/help/, replace this
// placeholder with <Image src={`/help/${name}.png`} alt={caption} width={900} height={506}
// className="rounded-md border" />. Capture ONLY from seed/demo data — never from a real
// tenant. See HARD CONSTRAINT in the plan: no screenshots of production/tenant data.
export function ScreenshotSlot({ name, caption }: ScreenshotSlotProps) {
  return (
    <figure className="mt-4 space-y-2">
      <div
        role="img"
        aria-label={`Screenshot placeholder: ${caption}`}
        className="flex aspect-video min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40"
      >
        <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground text-xs">Screenshot coming</span>
        <code className="text-muted-foreground/70 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          /help/{name}.png
        </code>
      </div>
      <figcaption className="text-muted-foreground text-xs">{caption}</figcaption>
    </figure>
  )
}
