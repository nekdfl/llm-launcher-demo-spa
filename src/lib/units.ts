/** Единицы измерения для мониторинга стенда.
 *
 * Память и скорости обмена показываются в собственных единицах, а не долей от
 * произвольного потолка: занятая память — в МиБ/ГиБ, скорость диска — в
 * КБ/с…МБ/с, скорость сети — в Кбит/с…Мбит/с. Единица подбирается по величине,
 * чтобы и «сотни байт», и «десятки мегабайт» читались соразмерно.
 *
 * Форматирование памяти намеренно отделено от lib/formatBytes: тот используется
 * для объёмов моделей и печатает GB/MB в десятичной записи, здесь же нужны
 * мебибайты и явная подпись единицы рядом со значением.
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** Занятая память: МиБ до 1 ГиБ, дальше ГиБ. */
export function formatMemory(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";

  if (bytes >= GIB) return `${(bytes / GIB).toFixed(bytes / GIB >= 10 ? 0 : 1)} ГиБ`;
  if (bytes >= MIB) return `${Math.round(bytes / MIB)} МиБ`;
  if (bytes >= KIB) return `${Math.round(bytes / KIB)} КиБ`;
  return `${Math.round(bytes)} Б`;
}

/** Скорость чтения/записи диска: КБ/с до 1 МБ/с, дальше МБ/с. */
export function formatByteRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) return "—";

  const kib = bytesPerSec / KIB;
  if (kib >= KIB) return `${(bytesPerSec / MIB).toFixed(bytesPerSec / MIB >= 10 ? 0 : 1)} МБ/с`;
  if (kib >= 1) return `${Math.round(kib)} КБ/с`;
  return `${Math.round(bytesPerSec)} Б/с`;
}

/** Скорость сети: в битах, а не байтах — так принято для сетевого трафика.
 * Приходят байты в секунду, поэтому умножаем на 8. */
export function formatBitRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) return "—";

  const bitsPerSec = bytesPerSec * 8;
  const kbit = bitsPerSec / 1000;
  if (kbit >= 1000) return `${(bitsPerSec / 1_000_000).toFixed(bitsPerSec / 1_000_000 >= 10 ? 0 : 1)} Мбит/с`;
  if (kbit >= 1) return `${Math.round(kbit)} Кбит/с`;
  return `${Math.round(bitsPerSec)} бит/с`;
}

/** Подпись единицы без значения — для легенды под графиком. */
export function unitLabelFor(kind: "memory" | "byteRate" | "bitRate"): string {
  switch (kind) {
    case "memory":
      return "МиБ/ГиБ";
    case "byteRate":
      return "КБ/с…МБ/с";
    case "bitRate":
      return "Кбит/с…Мбит/с";
  }
}
