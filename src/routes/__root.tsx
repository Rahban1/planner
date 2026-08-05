import { HeadContent, Scripts, createRootRoute, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'
import { useTheme } from '../lib/theme'
import { TopBar } from '../components/TopBar'
import { TaskModal } from '../components/TaskModal'
import { AgentRunModal } from '../components/AgentRunModal'
import { PlanModal } from '../components/PlanModal'
import { MembersModal } from '../components/MembersModal'
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
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'Planner' },
      { name: 'description', content: 'Plan, track, and hand work to autonomous agents.' },
      { name: 'theme-color', content: '#062318' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-title', content: 'Planner' },
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
      { rel: 'preload', as: 'image', href: '/bg.png' },
      { rel: 'preload', as: 'image', href: '/bg-dark.png' },
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
    scripts: [
      {
        children:
          "(function(){try{var s=localStorage.getItem('planner-theme');if(s==='light'||s==='dark'){document.documentElement.dataset.theme=s;var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content',s==='light'?'#fdfaf4':'#062318');}}catch(e){}})();",
      },
      {
        children:
          "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(e){console.warn('SW registration failed',e)})})}",
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
        onWordmarkClick={() => navigate({ to: '/dashboard' })}
        onLogout={() => {
          // Cloudflare Access logout clears the CF_Authorization cookie. Load
          // it in a hidden iframe (clears the cookie) then go to the public
          // landing page.
          const frame = document.createElement('iframe')
          frame.style.display = 'none'
          frame.src = '/cdn-cgi/access/logout'
          document.body.appendChild(frame)
          window.setTimeout(() => {
            window.location.assign('/landing')
          }, 600)
        }}
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
      <AgentRunModal />
      <PlanModal />
      <MembersModal />
      <ProjectModal />
      <CommandPalette onToggleTheme={toggle} />
      <ShortcutsHelp />
      <ConfirmDialog />
    </>
  )
}