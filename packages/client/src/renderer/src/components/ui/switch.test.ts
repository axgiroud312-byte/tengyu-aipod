// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Switch } from './switch'

afterEach(cleanup)

function ControlledSwitch({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false)

  return createElement(Switch, {
    'aria-label': '启用抠图',
    checked,
    disabled,
    onCheckedChange: setChecked,
  })
}

describe('Switch', () => {
  it('toggles a controlled switch through its accessible role', () => {
    render(createElement(ControlledSwitch))

    const toggle = screen.getByRole('switch', { name: '启用抠图' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('does not toggle when disabled', () => {
    render(createElement(ControlledSwitch, { disabled: true }))

    const toggle = screen.getByRole('switch', { name: '启用抠图' })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
