import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Search } from 'lucide-react'
import { Input } from './input'
import './search-box.css'

interface SearchBoxProps extends Omit<
  ComponentPropsWithoutRef<'input'>, 'className' | 'style' | 'size' | 'type' | 'onChange' | 'value' | 'defaultValue'
> {
  layout?: 'fill' | 'toolbar' | 'responsive-toolbar' | 'compact'
  type?: 'text' | 'search'
  placeholder: string
  value: string
  onValueChange: (value: string) => void
}

export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(
  ({ layout = 'fill', type = 'text', placeholder, value, onValueChange, ...props }, ref) => (
    <label className={`search-box search-box--${layout}`}>
      <Search size={17} aria-hidden="true" />
      <Input
        ref={ref}
        type={type}
        role="searchbox"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={event => onValueChange(event.target.value)}
        {...props}
      />
    </label>
  )
)
SearchBox.displayName = 'SearchBox'
