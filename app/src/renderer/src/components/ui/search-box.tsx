import { forwardRef, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from './button'
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
  ({ layout = 'fill', type = 'text', placeholder, value, onValueChange, ...props }, ref) => {
    const input = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => input.current!, [])

    return (
      <div className={`search-box search-box--${layout}`}>
        <Search size={17} aria-hidden="true" />
        <Input
          ref={input}
          type={type}
          role="searchbox"
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={event => onValueChange(event.target.value)}
          {...props}
        />
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="search-box-clear size-6 text-muted-foreground"
            aria-label="清空搜索"
            disabled={props.disabled || props.readOnly}
            onClick={() => {
              input.current?.focus()
              onValueChange('')
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    )
  }
)
SearchBox.displayName = 'SearchBox'
