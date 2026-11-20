import type { ComponentProps } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export default function WorkbenchSelect({
  label,
  options,
  className = 'w-full',
  ...props
}: ComponentProps<typeof Select> & {
  label: string
  options: ReadonlyArray<readonly [value: string, text: string]>
  className?: string
}) {
  return (
    <Select {...props}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map(([value, text]) => (
          <SelectItem key={value} value={value}>{text}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
