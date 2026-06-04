import Link from 'next/link'
import { BookOpen, ChevronRight } from 'lucide-react'

import { DOC_ARTICLES } from './content'

export default function DocsIndexPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen
            className="size-6 shrink-0"
            style={{ color: '#0A3D5C' }}
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: '#0A3D5C' }}>
            Altus Documentation
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Everything Altus does, in plain English. New here? Start with{' '}
          <Link
            href="/docs/getting-started"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: '#0A3D5C' }}
          >
            Getting started
          </Link>
          .
        </p>
      </header>

      <nav aria-label="Documentation articles">
        <ul className="grid gap-3 sm:grid-cols-2">
          {DOC_ARTICLES.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/docs/${article.slug}`}
                className="group flex items-start justify-between rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="space-y-0.5">
                  <p className="font-medium text-sm group-hover:underline group-hover:underline-offset-2" style={{ color: '#0A3D5C' }}>
                    {article.title}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {article.description}
                  </p>
                </div>
                <ChevronRight
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
