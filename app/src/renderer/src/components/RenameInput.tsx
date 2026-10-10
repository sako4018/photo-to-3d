import { useEffect, useRef } from 'react'

/** Text field for renaming: Enter or leaving it saves, Escape cancels. */
export function RenameInput({
  value,
  onCommit,
  onCancel,
  className
}: {
  value: string
  onCommit: (name: string) => void
  onCancel: () => void
  className?: string
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  function finish(save: boolean): void {
    if (done.current) return // Enter and the blur that follows must not both run
    done.current = true
    if (save) onCommit(input.current?.value ?? value)
    else onCancel()
  }

  return (
    <input
      ref={input}
      className={`rename-input ${className ?? ''}`}
      defaultValue={value}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}
