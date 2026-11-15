/** Совпадающее с профилем значение выглядит неактивным, но ввод в него
 * доступен и делает поле переопределением. */
export const INHERITED_BLOCK = "opacity-60";

/** Пометка рядом с подписью поля inference: «из профиля» или
 * «переопределено» со сбросом к значению профиля. */
export function InheritanceMark({ overridden, onReset, testId }: { overridden: boolean; onReset: () => void; testId: string }) {
  if (!overridden) {
    return (
      <span className="text-neutral-600 normal-case font-normal" data-testid={testId}>
        — из профиля
      </span>
    );
  }
  return (
    <span className="normal-case font-normal flex items-center gap-2" data-testid={testId}>
      <span className="text-warn">— переопределено</span>
      <button type="button" onClick={onReset} className="text-primary hover:underline">
        Сбросить к профилю
      </button>
    </span>
  );
}
