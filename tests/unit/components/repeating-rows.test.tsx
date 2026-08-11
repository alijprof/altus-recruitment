import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { RepeatingRows, type RepeatingRowField } from '@/components/app/repeating-rows'

// ---------------------------------------------------------------------------
// WR-06 + WR-11 regressions (review 2026-08-11).
//
// WR-06: the Title/School inputs rendered the native `required` attribute,
//        which hands the decision to the browser's constraint validation and
//        blocks submit before react-hook-form or zod runs. The schema
//        deliberately DROPS blank rows instead ("there is nothing to save,
//        not an error to surface"), so that behaviour was unreachable
//        whenever the section was open — a recruiter who added a row, changed
//        their mind and pressed Save got a native "Please fill out this
//        field" bubble on a control they considered empty on purpose.
//
// WR-11: shadcn's <FormControl> injects id / aria-describedby / aria-invalid
//        via Slot. This component declared none of them, so they were
//        dropped: the FormLabel's htmlFor pointed at an id that existed
//        nowhere and FormMessage was never announced.
// ---------------------------------------------------------------------------

const FIELDS: readonly RepeatingRowField[] = [
  { key: 'title', label: 'Title', placeholder: 'Senior Recruitment Consultant', required: true },
  { key: 'company', label: 'Company', placeholder: 'Altus Consultancy' },
  { key: 'dates', label: 'Dates', placeholder: 'Jan 2022 – Present' },
]

function ControlledRows({ initial = [] as Record<string, string>[] }) {
  const [value, setValue] = React.useState(initial)
  return (
    <RepeatingRows
      value={value}
      onChange={setValue}
      fields={FIELDS}
      addLabel="Add work history"
      rowLabel="Work history"
    />
  )
}

describe('RepeatingRows', () => {
  it('never renders the native required attribute on a row input (WR-06)', async () => {
    const user = userEvent.setup()
    render(<ControlledRows />)
    await user.click(screen.getByRole('button', { name: 'Add work history' }))

    const title = screen.getByLabelText('Title')
    // The whole point: an empty row must be submittable so the schema can
    // drop it. `required` here makes that unreachable.
    expect(title).not.toBeRequired()
    expect(title).not.toHaveAttribute('required')
  })

  it('an empty added row does not block form submission (WR-06)', async () => {
    const user = userEvent.setup()
    let submitted = false
    function Harness() {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitted = true
          }}
        >
          <ControlledRows />
          <button type="submit">Save</button>
        </form>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Add work history' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(submitted).toBe(true)
  })

  it('still marks the row-keeping field with a visual hint', async () => {
    const user = userEvent.setup()
    render(<ControlledRows />)
    await user.click(screen.getByRole('button', { name: 'Add work history' }))

    // Hint is aria-hidden, so the accessible name stays the plain label.
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('forwards the FormControl-injected accessibility props (WR-11)', () => {
    render(
      <RepeatingRows
        value={[]}
        onChange={() => {}}
        fields={FIELDS}
        addLabel="Add work history"
        rowLabel="Work history"
        id="work-experience-form-item"
        aria-describedby="work-experience-message"
        aria-invalid
      />,
    )

    const group = screen.getByRole('group', { name: 'Work history' })
    // The FormLabel's htmlFor must resolve to a real element, and
    // FormMessage must be announced for this group.
    expect(group).toHaveAttribute('id', 'work-experience-form-item')
    expect(group).toHaveAttribute('aria-describedby', 'work-experience-message')
    expect(group).toHaveAttribute('aria-invalid', 'true')
  })

  it('adds and removes rows without disturbing its siblings', async () => {
    const user = userEvent.setup()
    render(<ControlledRows initial={[{ title: 'A' }, { title: 'B' }, { title: 'C' }]} />)

    await user.click(screen.getByRole('button', { name: 'Remove Work history 2' }))

    const titles = screen.getAllByLabelText('Title') as HTMLInputElement[]
    expect(titles.map((i) => i.value)).toEqual(['A', 'C'])
  })
})
