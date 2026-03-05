export const initializeDarkMode = () => {
  const stored = localStorage.getItem("admin_dark_mode");
  if (stored !== null) return stored === "true";
  return true;
};

export const applyDarkMode = (isDark: boolean) => {
  if (isDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("admin_dark_mode", String(isDark));
};
