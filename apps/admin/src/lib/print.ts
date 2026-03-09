export function printModalContent(target: HTMLElement | null) {
  if (!target) return;

  const body = document.body;
  const printClass = "modal-print-active";
  const tempTargetClass = "print-target-modal-temp";
  const hadTargetClass = target.classList.contains("print-target-modal");

  if (!hadTargetClass) {
    target.classList.add("print-target-modal", tempTargetClass);
  }

  body.classList.add(printClass);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    body.classList.remove(printClass);
    if (!hadTargetClass) {
      target.classList.remove("print-target-modal", tempTargetClass);
    }
    window.removeEventListener("afterprint", onAfterPrint);
    window.removeEventListener("focus", onFocus, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  const onAfterPrint = () => cleanup();
  const onFocus = () => {
    if (document.visibilityState === "visible") cleanup();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") cleanup();
  };

  window.addEventListener("afterprint", onAfterPrint);
  window.addEventListener("focus", onFocus, true);
  document.addEventListener("visibilitychange", onVisibilityChange);

  window.setTimeout(() => {
    window.print();
  }, 0);
}
