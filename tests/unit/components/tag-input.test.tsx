import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { TagInput } from '@/components/app/tag-input'

// Controlled wrapper — mirrors how candidate-edit-form.tsx will drive this
// component via react-hook-form's field.value/field.onChange.
function ControlledTagInput({ initial = [] as string[] }: { initial?: string[] }) {
  const [value, setValue] = React.useState<string[]>(initial)
  return <TagInput value={value} onChange={setValue} placeholder="Add a skill…" />
}

describe('TagInput', () => {
  it('adds a chip on Enter and clears the input', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.type(input, 'React{Enter}')
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('adds two chips from a comma-separated entry followed by Enter', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.type(input, 'React, Node{Enter}')
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Node')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('does not duplicate a value that already exists case-insensitively', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initial={['React']} />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.type(input, 'react{Enter}')
    expect(screen.getAllByText(/^react$/i)).toHaveLength(1)
  })

  it('rejects a whitespace-only entry and adds no chip', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.type(input, '   {Enter}')
    expect(screen.queryAllByRole('button', { name: /^Remove/ })).toHaveLength(0)
  })

  it('removes exactly the chip whose remove control was clicked', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initial={['React', 'Node', 'SQL']} />)
    await user.click(screen.getByRole('button', { name: 'Remove Node' }))
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
    expect(screen.queryByText('Node')).not.toBeInTheDocument()
  })

  it('removes the last chip on Backspace when the input is empty', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initial={['React', 'Node']} />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.click(input)
    await user.keyboard('{Backspace}')
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.queryByText('Node')).not.toBeInTheDocument()
  })

  it('calls onChange with the new string[] on every mutation', async () => {
    const user = userEvent.setup()
    const onChange = (v: string[]) => calls.push(v)
    const calls: string[][] = []
    render(<TagInput value={[]} onChange={onChange} placeholder="Add a skill…" />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.type(input, 'React{Enter}')
    expect(calls).toEqual([['React']])
  })

  it('renders the chips given via the controlled value prop', () => {
    render(<TagInput value={['React', 'Node']} onChange={() => {}} placeholder="Add a skill…" />)
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Node')).toBeInTheDocument()
  })

  // --- WR-05 (review 2026-08-11): stored duplicates ----------------------
  //
  // mergeTags stops the component ADDING a duplicate, but `value` arrives
  // from candidates.skills and nothing dedupes on write — coerceStringArray
  // only drops non-strings and blanks, and the LinkedIn ingest writes the
  // scraped array verbatim. `["React","React"]` out of Claude is ordinary.

  it('renders one chip per distinct value when the stored array has duplicates', () => {
    render(
      <TagInput
        value={['React', 'React', 'Node']}
        onChange={() => {}}
        placeholder="Add a skill…"
      />,
    )
    expect(screen.getAllByText('React')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
  })

  it('dedupes case-insensitive stored duplicates, keeping first-seen casing', () => {
    render(
      <TagInput
        value={['React', 'REACT', 'react']}
        onChange={() => {}}
        placeholder="Add a skill…"
      />,
    )
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1)
    expect(screen.getByText('React')).toBeInTheDocument()
  })

  it('removing a duplicated chip removes exactly that one chip, and it stays gone', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initial={['React', 'React', 'Node']} />)

    await user.click(screen.getByRole('button', { name: 'Remove React' }))

    // The bug this pins: the chip visibly disappeared and then came back,
    // because only one of the two stored copies had been dropped.
    expect(screen.queryByText('React')).not.toBeInTheDocument()
    expect(screen.getByText('Node')).toBeInTheDocument()
  })

  it('does not remove a sibling chip when a duplicate is removed', async () => {
    const user = userEvent.setup()
    const calls: string[][] = []
    render(
      <TagInput
        value={['React', 'React', 'Node']}
        onChange={(v) => calls.push(v)}
        placeholder="Add a skill…"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remove React' }))

    expect(calls).toEqual([['Node']])
  })

  it('Backspace removes the last CHIP even when it is stored twice', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initial={['Node', 'React', 'React']} />)
    const input = screen.getByPlaceholderText('Add a skill…')
    await user.click(input)
    await user.keyboard('{Backspace}')

    // Slicing the raw array would have left one 'React' behind, so the chip
    // would have looked unresponsive.
    expect(screen.queryByText('React')).not.toBeInTheDocument()
    expect(screen.getByText('Node')).toBeInTheDocument()
  })

  it('hides blank stored entries rather than rendering an empty chip', () => {
    render(<TagInput value={['React', '', '  ']} onChange={() => {}} placeholder="Add a skill…" />)
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1)
  })
})
