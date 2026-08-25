import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  BookOpenText,
  Braces,
  ChevronRight,
  Compass,
  Rocket,
  Wrench,
} from 'lucide-react'
import { marked } from 'marked'
import docsIndex from '../../docs/README.md?raw'
import gettingStarted from '../../docs/GETTING_STARTED.md?raw'
import architecture from '../../docs/ARCHITECTURE.md?raw'
import operations from '../../docs/OPERATIONS.md?raw'
import reference from '../../docs/REFERENCE.md?raw'
import '#/docs.css'

const documents = [
  {
    slug: 'overview',
    short: '00',
    title: 'Overview',
    description: 'Start here and select the document that you need.',
    markdown: docsIndex,
    icon: Compass,
  },
  {
    slug: 'getting-started',
    short: '01',
    title: 'Getting started',
    description: 'Install Planner and get the first local result.',
    markdown: gettingStarted,
    icon: Rocket,
  },
  {
    slug: 'architecture',
    short: '02',
    title: 'Architecture',
    description: 'Understand components, data, and agent flows.',
    markdown: architecture,
    icon: BookOpenText,
  },
  {
    slug: 'operations',
    short: '03',
    title: 'Operations',
    description: 'Run, test, migrate, deploy, and troubleshoot.',
    markdown: operations,
    icon: Wrench,
  },
  {
    slug: 'reference',
    short: '04',
    title: 'Reference',
    description: 'Find routes, functions, tables, and settings.',
    markdown: reference,
    icon: Braces,
  },
] as const

type DocumentSlug = (typeof documents)[number]['slug']

const routeByFile: Record<string, string> = {
  'README.md': '/docs',
  'GETTING_STARTED.md': '/docs/getting-started',
  'ARCHITECTURE.md': '/docs/architecture',
  'OPERATIONS.md': '/docs/operations',
  'REFERENCE.md': '/docs/reference',
}

const renderer = new marked.Renderer()

renderer.heading = function ({ tokens, depth }) {
  const html = this.parser.parseInline(tokens)
  const text = html.replace(/<[^>]+>/g, '')
  const id = slugify(text)
  return `<h${depth} id="${id}">${html}</h${depth}>`
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function rewriteDocumentLinks(markdown: string) {
  return markdown.replace(
    /\]\((README|GETTING_STARTED|ARCHITECTURE|OPERATIONS|REFERENCE)\.md(#[^)]+)?\)/g,
    (_match, file: string, hash = '') =>
      `](${routeByFile[`${file}.md`]}${hash})`,
  )
}

function getDocument(slug: string) {
  return documents.find((document) => document.slug === slug)
}

function readingTime(markdown: string) {
  const words = markdown.trim().split(/\s+/).length
  return Math.max(1, Math.ceil(words / 220))
}

export function DocsPage({ slug }: { slug: string }) {
  const document = getDocument(slug)
  const html = useMemo(() => {
    if (!document) return ''
    return marked.parse(rewriteDocumentLinks(document.markdown), {
      async: false,
      renderer,
    }) as string
  }, [document])

  if (!document) {
    return (
      <main className="docs-page docs-missing">
        <p className="docs-kicker">Planner field manual</p>
        <h1 className="serif">Document not found.</h1>
        <p>The requested document does not exist.</p>
        <Link to="/docs" className="docs-return">
          Open the documentation index <ChevronRight size={14} />
        </Link>
      </main>
    )
  }

  return (
    <main className="docs-page">
      <aside className="docs-rail" aria-label="Documentation index">
        <div className="docs-rail-head">
          <p className="docs-kicker">Planner field manual</p>
          <p className="docs-edition">Edition 01 / ASD-STE100</p>
        </div>

        <nav className="docs-nav">
          {documents.map((item) => (
            <DocumentLink
              key={item.slug}
              item={item}
              active={item.slug === document.slug}
            />
          ))}
        </nav>

        <a
          className="docs-source-link"
          href="https://github.com/Rahban1/planner/tree/docs/full-documentation/docs"
          target="_blank"
          rel="noreferrer"
        >
          Read source on GitHub <ArrowUpRight size={13} />
        </a>
      </aside>

      <section className="docs-reader">
        <header className="docs-reader-head">
          <div>
            <span>Document {document.short}</span>
            <strong>{document.title}</strong>
          </div>
          <div className="docs-reader-meta">
            <span>{readingTime(document.markdown)} min read</span>
            <span>Updated 25 Aug 2026</span>
          </div>
        </header>

        <article
          className="docs-prose"
          // The Markdown files are trusted repository content. They are not user input.
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <footer className="docs-reader-foot">
          <span>End of document {document.short}</span>
          <Link to="/docs">Documentation index</Link>
        </footer>
      </section>
    </main>
  )
}

function DocumentLink({
  item,
  active,
}: {
  item: (typeof documents)[number]
  active: boolean
}) {
  const Icon = item.icon
  const content = (
    <>
      <span className="docs-nav-number">{item.short}</span>
      <span className="docs-nav-icon">
        <Icon size={15} />
      </span>
      <span className="docs-nav-copy">
        <strong>{item.title}</strong>
        <small>{item.description}</small>
      </span>
      <ChevronRight className="docs-nav-arrow" size={14} />
    </>
  )
  const className = `docs-nav-link${active ? ' active' : ''}`

  if (item.slug === 'overview') {
    return (
      <Link
        to="/docs"
        className={className}
        aria-current={active ? 'page' : undefined}
      >
        {content}
      </Link>
    )
  }

  return (
    <Link
      to="/docs/$slug"
      params={{ slug: item.slug }}
      className={className}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  )
}

export function isDocumentSlug(slug: string): slug is DocumentSlug {
  return documents.some((document) => document.slug === slug)
}
