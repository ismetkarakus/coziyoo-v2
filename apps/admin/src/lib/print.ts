const PRINT_CLONE_ID = "print-root-clone";

export function printModalContent(target: HTMLElement | null) {
  if (!target) return;

  // Remove any leftover clone from a previous print
  document.getElementById(PRINT_CLONE_ID)?.remove();

  const clone = target.cloneNode(true) as HTMLElement;
  clone.id = PRINT_CLONE_ID;
  // Strip inline positioning/transform styles that come from modal layout
  clone.style.cssText = "";

  // Remove interactive footer buttons – they shouldn't appear in print
  clone.querySelectorAll(".buyer-ops-modal-actions").forEach((el) => el.remove());

  document.body.appendChild(clone);
  document.body.classList.add("modal-print-active");

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("modal-print-active");
    document.getElementById(PRINT_CLONE_ID)?.remove();
    window.removeEventListener("afterprint", onAfterPrint);
    window.removeEventListener("focus", onFocus, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  const onAfterPrint = () => cleanup();
  const onFocus = () => { if (document.visibilityState === "visible") cleanup(); };
  const onVisibilityChange = () => { if (document.visibilityState === "visible") cleanup(); };

  window.addEventListener("afterprint", onAfterPrint);
  window.addEventListener("focus", onFocus, true);
  document.addEventListener("visibilitychange", onVisibilityChange);

  window.setTimeout(() => { window.print(); }, 60);
}
