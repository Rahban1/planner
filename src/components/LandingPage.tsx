import { useState } from 'react'
import { ArrowRight, Bot, Check, CircleDot, GitPullRequest, ListChecks } from 'lucide-react'

const views = ['Today', 'Projects', 'Agents'] as const

export function LandingPage() {
  const [view, setView] = useState<(typeof views)[number]>('Today')
  const message = view === 'Today'
    ? 'Save the thought now. Decide later whether you do it—or hand it to an agent.'
    : view === 'Projects'
      ? 'Your saved to-dos stay attached to the work they belong to, not lost in another list.'
      : 'Agents turn a scoped to-do into a reviewed plan and a pull request you can approve.'

  return (
    <main className="landing-page">
      <section className="landing-shell landing-hero">
        <div>
          <p className="landing-eyebrow"><CircleDot size={14} /> The todo list that works for you</p>
          <h1>From “I should do that” to <em>“it’s in review.”</em></h1>
        </div>
        <div className="landing-intro">
          <p>{message}</p>
          <a className="landing-primary" href="/login">Get started <ArrowRight size={16} /></a>
        </div>
      </section>

      <section className="landing-shell" id="control-room" aria-label="Planner product preview">
        <div className="landing-console">
          <aside>
            <div className="landing-console-brand">Planner<span>.</span></div>
            {views.map((item) => (
              <button key={item} onClick={() => setView(item)} className={view === item ? 'active' : ''}>
                {item}
              </button>
            ))}
            <small>Built for focused teams</small>
          </aside>
          <div className="landing-console-main">
            <header>
              <div><span>FOCUS MODE</span><h2>{view}</h2></div>
              <button className="landing-avatar" aria-label="Open profile">RG</button>
            </header>
            {view === 'Today' && <div className="landing-console-content">
              <div className="landing-panel"><p>Saved to-dos</p><Task title="Fix the mobile experience" sub="Product · ready for an agent" action="Delegate" /><Task title="Review agent plan for sync" sub="Platform · 2 comments" action="Review" /></div>
              <Stat icon={<ListChecks size={22} />} value="08" label="saved to-dos" />
            </div>}
            {view === 'Projects' && <div className="landing-console-content">
              <div className="landing-project-bars"><Progress label="Mobile launch" width="78%" /><Progress label="Design system" width="54%" /><Progress label="Team rituals" width="31%" /></div>
              <Stat icon={<Check size={22} />} value="3" label="projects in motion" />
            </div>}
            {view === 'Agents' && <div className="landing-console-content">
              <div className="landing-agent-live"><Bot size={22} /><div><b>Agent is preparing a plan</b><small>Fix mobile experience · reading the codebase</small></div><i /></div>
              <Stat icon={<GitPullRequest size={22} />} value="12" label="PRs opened" />
            </div>}
          </div>
        </div>
      </section>

      <section className="landing-shell landing-steps" aria-label="How Planner works">
        <div><span>01</span><h3>Save every to-do.</h3><p>Give every idea, errand, and project task a calm home before it disappears.</p></div>
        <div><span>02</span><h3>Choose the work that matters.</h3><p>Turn a crowded list into one clear next move, with the context still attached.</p></div>
        <div><span>03</span><h3>Give it to an agent.</h3><p>Review a plan, approve it, and get back a pull request that is ready for your eyes.</p></div>
      </section>
    </main>
  )
}

function Task({ title, sub, action }: { title: string; sub: string; action: string }) {
  return <div className="landing-task"><i /><div><b>{title}</b><small>{sub}</small></div><strong>{action}</strong></div>
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div className="landing-stat">{icon}<b>{value}</b><span>{label}</span></div>
}

function Progress({ label, width }: { label: string; width: string }) {
  return <span>{label}<i style={{ width }} /></span>
}
