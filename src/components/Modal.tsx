import { useEffect, type ReactNode } from "react";

/** Modal per UI-BEHAVIOR §2 — used only for one-shot light input: "Сохранить
 * как" (profile copy), "Установить из tar.gz" (plugin), model deletion
 * confirmation. The container hides via the `hidden` attribute, and the
 * global stylesheet must force `[hidden] { display: none !important; }` —
 * §2 documents the specificity bug where a Tailwind flex/grid utility on the
 * same element beats `[hidden]` and leaves the modal visible on page load. */
export function Modal({
  open,
  onClose,
  title,
  tone = "primary",
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tone?: "primary" | "danger";
  children?: ReactNode;
  testId?: string;
}) {
  // Escape closes too — a modal that traps the keyboard is worse than none.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const titleColor = tone === "danger" ? "text-danger" : "text-primary";
  const accent = tone === "danger" ? { boxShadow: "inset 4px 0 0 0 #ff5c5c" } : undefined;

  return (
    <div
      hidden={!open}
      data-testid={testId}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
    >
      <div className="bg-surface-container-low w-full max-w-sm p-6" style={accent}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-['Space_Grotesk'] text-sm font-bold uppercase tracking-widest ${titleColor}`}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="material-symbols-outlined text-neutral-500 hover:text-neutral-200 text-lg"
            aria-label="Закрыть"
          >
            close
          </button>
        </div>
        {open && children}
      </div>
    </div>
  );
}
