import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('TopBar', () => {
  it('exposes an accessible logout button and invokes it when clicked', () => {
    const onLogout = vi.fn()

    render(
      <TopBar theme="dark" onToggleTheme={vi.fn()} onLogout={onLogout} />,
    )

    const logoutButton = screen.getByRole('button', { name: 'Log out' })
    expect(logoutButton).toHaveAttribute('title', 'Log out')
    expect(logoutButton).toHaveAttribute('type', 'button')

    fireEvent.click(logoutButton)

    expect(onLogout).toHaveBeenCalledOnce()
  })
})
