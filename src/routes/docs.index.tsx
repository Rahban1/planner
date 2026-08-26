import { createFileRoute } from '@tanstack/react-router'
import { DocsPage } from '#/components/DocsPage'

export const Route = createFileRoute('/docs/')({
  head: () => ({
    meta: [
      { title: 'Planner documentation' },
      {
        name: 'description',
        content:
          'Read the Planner setup, architecture, operations, and technical reference.',
      },
    ],
  }),
  component: () => <DocsPage slug="overview" />,
})
