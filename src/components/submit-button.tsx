"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ idleLabel, pendingLabel }: { idleLabel: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:cursor-wait disabled:bg-slate-400"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
