import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/docs')({
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
  component: DocsLayout,
})

function DocsLayout() {
  return <Outlet />
}
