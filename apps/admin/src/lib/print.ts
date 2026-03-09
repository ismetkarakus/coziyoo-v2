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
  };

  const onAfterPrint = () => cleanup();
  window.addEventListener("afterprint", onAfterPrint);

  window.setTimeout(() => {
    window.print();
    window.setTimeout(cleanup, 2500);
  }, 0);
}
