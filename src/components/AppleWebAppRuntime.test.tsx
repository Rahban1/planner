import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppleWebAppRuntime } from './AppleWebAppRuntime'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps the composer above the keyboard and restores navigation after dismissal', async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 844,
    scale: 1,
    offsetTop: 0,
  })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 844)
  render(
    <>
      <AppleWebAppRuntime />
      <textarea aria-label="Message" />
    </>,
  )
  document.querySelector('textarea')?.focus()
  viewport.height = 440
  viewport.dispatchEvent(new Event('resize'))
  await waitFor(() =>
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(
      true,
    ),
  )
  expect(document.body.style.height).toBe('440px')
  viewport.height = 844
  viewport.dispatchEvent(new Event('resize'))
  await waitFor(() =>
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(
      false,
    ),
  )
  expect(document.body.style.height).toBe('')
})

it('does not resize the app when the user zooms and removes viewport state on unmount', async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 844,
    scale: 1,
    offsetTop: 0,
  })
  vi.stubGlobal('visualViewport', viewport)
  const { unmount } = render(<AppleWebAppRuntime />)
  viewport.scale = 2
  viewport.height = 422
  viewport.dispatchEvent(new Event('resize'))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(
    document.documentElement.style.getPropertyValue('--visual-viewport-height'),
  ).toBe('844px')
  expect(document.body.style.height).toBe('')
  unmount()
  expect(
    document.documentElement.style.getPropertyValue('--visual-viewport-height'),
  ).toBe('')
})
