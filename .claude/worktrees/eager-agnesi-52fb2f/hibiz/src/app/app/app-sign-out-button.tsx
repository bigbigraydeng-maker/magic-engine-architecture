"use client";

import { useFormStatus } from "react-dom";

export function AppSignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="text-stone-500 hover:text-stone-800 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
