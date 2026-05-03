"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export interface FormSubmitPendingButtonProps {
  children: ReactNode;
  pendingLabel: ReactNode;
  className?: string;
}

/** 必须放在 `<form action={serverAction}>` 内部，提交中时禁用并切换文案 */
export function FormSubmitPendingButton({ children, pendingLabel, className }: FormSubmitPendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={["disabled:cursor-wait disabled:opacity-80", className ?? ""].filter(Boolean).join(" ")}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export interface FormPendingHintProps {
  children: ReactNode;
  className?: string;
}

/** 与提交按钮同表单内；仅在 pending 时显示说明（避免用户以为无响应） */
export function FormPendingHint({ children, className }: FormPendingHintProps) {
  const { pending } = useFormStatus();
  if (!pending) {
    return null;
  }
  return <p className={className ?? "mt-2 text-xs font-medium text-amber-800"}>{children}</p>;
}
