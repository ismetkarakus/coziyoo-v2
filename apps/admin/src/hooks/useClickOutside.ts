import { type RefObject, useEffect } from "react";

export function useClickOutside(ref: RefObject<HTMLElement | null>, onClickOutside: () => void): void {
  useEffect(() => {
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [ref, onClickOutside]);
}
