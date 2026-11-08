import { useEffect, useRef, useState } from "react";
import { orchestratorApi } from "../api/orchestrator";
import type { DownloadStats } from "../api/types";
import { formatBytes } from "../lib/formatBytes";

export const STATS_POLL_INTERVAL_MS = 2000;

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}ч ${minutes}м`;
  if (minutes > 0) return `${minutes}м ${rest}с`;
  return `${rest}с`;
}

/** Панель статистики загрузок (download-queue-stats) — самодостаточный
 * компонент: сам запрашивает сводку и обновляет её, поэтому его достаточно
 * поставить на страницу. Показывается на всех страницах-списках раздела
 * моделей; на странице конкретной модели — нет.
 *
 * Число скачанных моделей приходит тем же ответом: иначе панель тянула бы
 * весь список моделей ради его длины на каждом цикле опроса. */
export function DownloadStatsPanel() {
  const [stats, setStats] = useState<DownloadStats | null>(null);
  // Последняя известная скорость: пока закачки идут, опрос без скорости
  // (первый замер, воркер ещё не сообщил) не превращает её в «—».
  const lastSpeed = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      orchestratorApi
        .getDownloadStats()
        .then((next) => !cancelled && setStats(next))
        // Сбой одного опроса — не повод убирать панель: остаются прежние цифры.
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, STATS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!stats) return null;

  const downloading = stats.downloading_count ?? (stats.speed_bytes_per_sec !== null ? 1 : 0);
  if (downloading === 0) lastSpeed.current = null;
  else if (stats.speed_bytes_per_sec !== null) lastSpeed.current = stats.speed_bytes_per_sec;
  const speed = downloading > 0 ? lastSpeed.current : null;

  const cells: { label: string; value: string }[] = [
    { label: "Активно", value: String(stats.active_count) },
    { label: "Готово", value: String(stats.completed_count) },
    { label: "Моделей", value: String(stats.models_count ?? 0) },
    { label: "Свободно", value: stats.free_bytes !== null ? formatBytes(stats.free_bytes) : "—" },
    { label: "Осталось", value: formatBytes(stats.remaining_bytes) },
    { label: "Скорость", value: speed !== null ? `${formatBytes(speed)}/с` : "—" },
    { label: "ETA загружаемых", value: formatDuration(stats.eta_active_seconds) },
    { label: "ETA очереди", value: formatDuration(stats.eta_all_seconds) },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-4 bg-surface-container-lowest p-4"
      data-testid="download-stats"
    >
      {cells.map((cell) => (
        <div key={cell.label}>
          <div className="text-[10px] uppercase text-neutral-500 font-['Space_Grotesk']">{cell.label}</div>
          <div className="text-sm text-on-surface font-mono">{cell.value}</div>
        </div>
      ))}
    </div>
  );
}
