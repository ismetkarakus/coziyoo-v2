import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Language } from "../../types/core";

type PrintButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  language: Language;
  children?: ReactNode;
  labelTr?: string;
  labelEn?: string;
};

export function PrintButton({
  language,
  children,
  labelTr = "Yazdır",
  labelEn = "Print",
  ...buttonProps
}: PrintButtonProps) {
  return <button {...buttonProps}>{children ?? (language === "tr" ? labelTr : labelEn)}</button>;
}
