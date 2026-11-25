import type { MutableRefObject, ReactElement, Ref } from 'react'

export function elementRef<Element>(element: ReactElement): Ref<Element> | undefined {
  return (element as ReactElement & { ref?: Ref<Element> }).ref
}

export function assignRef<Element>(ref: Ref<Element> | undefined, value: Element | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    const mutableRef = ref as MutableRefObject<Element | null>
    mutableRef.current = value
  }
}
