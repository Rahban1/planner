import { HeadContent, Scripts, createRootRoute, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect } from 'react'

import appCss from '../styles.css?url'
import { useTheme } from '../lib/theme'
import { TopBar } from '../components/TopBar'
import { TaskModal } from '../components/TaskModal'
import { CommandPalette } from '../components/CommandPalette'
import { UIProvider, useUI } from '../lib/ui-context'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Planner' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap',
      },
    ],
    scripts: [
      {
        children:
          "(function(){try{var s=localStorage.getItem('planner-theme');if(s==='light'||s==='dark'){document.documentElement.dataset.theme=s;}}catch(e){}})();",
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="app-bg" />
        <UIProvider>
          <AppShell>{children}</AppShell>
        </UIProvider>
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const ui = useUI()

  // Global ⌘ K handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.openCmdk()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui])

  return (
    <>
      <TopBar
        theme={theme}
        onToggleTheme={toggle}
        onWordmarkClick={() => navigate({ to: '/' })}
      />
      {children}
      <TaskModal
        taskId={ui.taskModal?.taskId ?? null}
        projectId={ui.taskModal?.projectIdForNew ?? null}
        projectName={ui.taskModal?.projectName}
        projectRepoUrl={ui.taskModal?.projectRepoUrl}
        onClose={ui.closeTask}
        onOpenProject={(pid) => navigate({ to: '/projects/$id', params: { id: pid } })}
      />
      <CommandPalette onToggleTheme={toggle} />
    </>
  )
}