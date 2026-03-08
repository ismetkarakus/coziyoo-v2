export function printModalContent(target: HTMLElement | null, bodyClass = "modal-print-active") {
  if (!target) return;
  const body = document.body;
  body.classList.add(bodyClass);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    body.classList.remove(bodyClass);
    window.removeEventListener("afterprint", handleAfterPrint);
  };

  const handleAfterPrint = () => {
    cleanup();
  };

  window.addEventListener("afterprint", handleAfterPrint);
  window.setTimeout(() => {
    window.print();
    window.setTimeout(cleanup, 2000);
  }, 0);
}
