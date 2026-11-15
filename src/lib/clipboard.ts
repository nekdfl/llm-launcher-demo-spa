/** Копирует текст в буфер обмена. `navigator.clipboard` есть только в
 * secure context, а стенд открывается по HTTP и копия `reference/` — из
 * `file://`, поэтому один способ для всех случаев: выделение во временном
 * `textarea` + `execCommand("copy")`. Возвращает, удалось ли копирование. */
export function copyText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
