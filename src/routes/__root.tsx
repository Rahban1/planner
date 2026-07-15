import { HeadContent, Scripts, createRootRoute, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'
import { useTheme } from '../lib/theme'
import { TopBar } from '../components/TopBar'
import { TaskModal } from '../components/TaskModal'
import { ProjectModal } from '../components/ProjectModal'
import { CommandPalette } from '../components/CommandPalette'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { UIProvider, useUI } from '../lib/ui-context'
import { FocusProvider } from '../lib/focus-context'
import { useKeyboardShortcuts } from '../lib/useKeyboardShortcuts'

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
          <FocusProvider>
            <AppShell>{children}</AppShell>
          </FocusProvider>
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

  useKeyboardShortcuts(toggle)

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
        onTaskSaved={(savedTaskId) => {
          const projectName = ui.taskModal?.projectName
          const projectRepoUrl = ui.taskModal?.projectRepoUrl
          ui.openTask(savedTaskId, projectName, projectRepoUrl)
        }}
      />
      <ProjectModal />
      <CommandPalette onToggleTheme={toggle} />
      <ShortcutsHelp />
      <ConfirmDialog />
    </>
  )
}