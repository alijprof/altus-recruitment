import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'

import { DOC_ARTICLES, DOC_BY_SLUG } from '../content'

interface PageProps {
  params: Promise<{ slug: string }>
}

// Pre-render all doc articles at build time.
export function generateStaticParams(): { slug: string }[] {
  return DOC_ARTICLES.map((article) => ({ slug: article.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const article = DOC_BY_SLUG[slug]
  if (!article) return {}
  return {
    title: `${article.title} — Altus Docs`,
    description: article.description,
  }
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params
  const article = DOC_BY_SLUG[slug]

  if (!article) {
    notFound()
  }

  return (
    <article className="space-y-8">
      {/* Back link */}
      <Link
        href="/docs"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All articles
      </Link>

      {/* Article header */}
      <header className="space-y-2">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ color: '#0A3D5C' }}
        >
          {article.title}
        </h1>
        <p className="text-muted-foreground text-sm">{article.description}</p>
      </header>

      {/* Sections */}
      <div className="space-y-8">
        {article.sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2
              className="text-base font-semibold"
              style={{ color: '#0A3D5C' }}
            >
              {section.heading}
            </h2>
            <div className="space-y-3">
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-muted-foreground text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Article navigation — link to other articles */}
      <nav aria-label="Article navigation" className="border-border/60 border-t pt-8">
        <p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
          Other articles
        </p>
        <ul className="flex flex-wrap gap-2">
          {DOC_ARTICLES.filter((a) => a.slug !== slug).map((other) => (
            <li key={other.slug}>
              <Link
                href={`/docs/${other.slug}`}
                className="text-muted-foreground hover:text-foreground rounded border px-3 py-1 text-xs transition-colors hover:border-current"
              >
                {other.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  )
}
