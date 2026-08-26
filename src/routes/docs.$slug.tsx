import { createFileRoute } from '@tanstack/react-router'
import { DocsPage } from '#/components/DocsPage'

export const Route = createFileRoute('/docs/$slug')({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug.replace(/-/g, ' ')} | Planner documentation` },
      {
        name: 'description',
        content: 'Read the Planner product and engineering documentation.',
      },
    ],
  }),
  component: DocumentRoute,
})

function DocumentRoute() {
  const { slug } = Route.useParams()
  return <DocsPage slug={slug} />
}
