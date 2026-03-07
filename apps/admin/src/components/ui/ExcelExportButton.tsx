import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Language } from "../../types/core";

type ExcelExportButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  language: Language;
  children?: ReactNode;
  labelTr?: string;
  labelEn?: string;
};

export function ExcelExportButton({
  language,
  children,
  labelTr = "Excel'e Aktar",
  labelEn = "Export to Excel",
  ...buttonProps
}: ExcelExportButtonProps) {
  return (
    <button {...buttonProps}>
      {children ?? (language === "tr" ? labelTr : labelEn)}
    </button>
  );
}

