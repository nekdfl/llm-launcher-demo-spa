import type { HostLoadSnapshot } from "../api/orchestrator";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Загрузка стенда в собственных единицах.
 *
 * Направления обмена остаются раздельными (чтение/запись, приём/отдача): сумма
 * скрывала бы, что именно происходит с диском и сетью. Приведения к потолку
 * закачек здесь нет — потолок отвечает на вопрос «успевает ли закачка удержать
 * лимит», а не «что происходит с железом».
 */
export interface StandLoadValues {
  /** Загрузка CPU, 0–100. */
  cpu: number;
  /** Занятая память в байтах; null — общий объём стенда неизвестен. */
  ramBytes: number | null;
  /** Запасной вариант, когда объём стенда неизвестен: загрузка RAM, 0–100. */
  ramPercent: number;
  /** Чтение с диска, байт/с. */
  diskRead: number;
  /** Запись на диск, байт/с. */
  diskWrite: number;
  /** Приём из сети, байт/с. */
  netRecv: number;
  /** Отдача в сеть, байт/с. */
  netSent: number;
}

/** `totalRamBytes` берётся из /resources/hardware-info. Объём стенда за сессию
 * не меняется, поэтому процент из исторического ряда переводится в объём
 * умножением на константу, а не хранится вторым рядом. */
export function toStandLoadValues(
  snapshot: HostLoadSnapshot,
  totalRamBytes: number | null
): StandLoadValues {
  const ramPercent = clamp(snapshot.ram_percent, 0, 100);

  return {
    cpu: clamp(snapshot.cpu_percent, 0, 100),
    ramBytes: totalRamBytes && totalRamBytes > 0 ? (ramPercent / 100) * totalRamBytes : null,
    ramPercent,
    diskRead: Math.max(0, snapshot.disk_read_bytes_per_sec),
    diskWrite: Math.max(0, snapshot.disk_write_bytes_per_sec),
    netRecv: Math.max(0, snapshot.net_recv_bytes_per_sec),
    netSent: Math.max(0, snapshot.net_sent_bytes_per_sec),
  };
}
