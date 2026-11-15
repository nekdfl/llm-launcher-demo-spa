import { type RefObject, useLayoutEffect } from "react";

function fitHeight(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  const border = area.offsetHeight - area.clientHeight;
  area.style.height = `${area.scrollHeight + border}px`;
}

/** Высота textarea по содержимому — весь текст виден без вертикальной
 * прокрутки. Пересчёт при смене текста и ширины поля (перенос строк). */
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement>, value: string) {
  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current);
  }, [ref, value]);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      // Реагируем только на ширину: своя смена высоты не должна зацикливать.
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      fitHeight(area);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [ref]);
}
