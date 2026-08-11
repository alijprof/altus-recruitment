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
})
