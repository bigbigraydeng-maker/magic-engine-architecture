"use client";

import { useEffect, useRef, useTransition } from "react";
import { updateSkeletonDraftField } from "@/app/app/projects/skeleton-edit-actions";

interface EditableInlineTextProps {
  projectId: string;
  moduleId: string;
  field: "title" | "subtitle";
  initialText: string;
  as: "h1" | "p";
  className?: string;
}

export function EditableInlineText({
  projectId,
  moduleId,
  field,
  initialText,
  as: Tag,
  className,
}: EditableInlineTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (el.innerText.trim() !== initialText.trim()) {
      el.innerText = initialText;
    }
  }, [initialText]);

  function onBlur() {
    const el = ref.current;
    if (!el) {
      return;
    }
    const v = el.innerText.trim();
    if (v === initialText.trim()) {
      return;
    }
    startTransition(() => {
      const fd = new FormData();
      fd.set("project_id", projectId);
      fd.set("module_id", moduleId);
      fd.set("field", field);
      fd.set("value", v);
      void updateSkeletonDraftField(fd);
    });
  }

  return (
    <Tag ref={ref as never} contentEditable suppressContentEditableWarning className={className} onBlur={onBlur} />
  );
}
