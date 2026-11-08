import { useEffect, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import type { HardwareInfo, HistorySettings } from "../../api/types";
import { formatBytes } from "../../lib/formatBytes";
import type { SystemUser } from "../../api/types";
import { GpuChecklist } from "../../components/GpuChecklist";
import { Modal } from "../../components/Modal";
import {
  FIELD_INPUT,
  FIELD_LABEL,
  GHOST_BUTTON,
  PageHeader,
  PRIMARY_BUTTON,
  SECTION_CARD,
  SECTION_TITLE,
  StatusBadge,
} from "../../components/ui";
import { accountsApi } from "../../api/accounts";

/** /settings/users — «Пользователи» (reference/settings, users table):
 * a standalone §1 page with a back link, not an anchor on the hub. */
export function UsersSettingsPage() {
  const [users, setUsers] = useState<SystemUser[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsAdmin(await accountsApi.isAdmin());
      if (await accountsApi.isAdmin()) {
        accountsApi
          .listUsers()
          .then(setUsers)
          .catch(() => setUsers(null));
      }
    })();
  }, []);

  async function toggleUserActive(user: SystemUser) {
    try {
      await accountsApi.updateUser(user.id, { is_active: !user.is_active });
      setUsers(await accountsApi.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пользователя");
    }
  }

  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Пользователи">
        {isAdmin && (
          <button onClick={() => setCreateOpen(true)} className={PRIMARY_BUTTON}>
            Создать пользователя
          </button>
        )}
      </PageHeader>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <section className={SECTION_CARD}>
        {users === null ? (
          <p className="text-xs text-neutral-500 font-mono">
            {isAdmin ? "Загрузка…" : "Управление пользователями доступно только роли admin."}
          </p>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
                <th className="text-left py-2 font-normal">Логин</th>
                <th className="text-left font-normal">Роль</th>
                <th className="text-left font-normal">Статус</th>
                <th className="text-left font-normal"></th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              {users.map((user) => (
                <tr key={user.id} className="border-b border-neutral-900">
                  <td className="py-2">{user.username}</td>
                  <td className={user.role === "admin" ? "text-primary" : ""}>{user.role}</td>
                  <td className={user.is_active ? "" : "text-danger"}>{user.is_active ? "активен" : "заблокирован"}</td>
                  <td>
                    <button
                      onClick={() => toggleUserActive(user)}
                      className={`${user.is_active ? "text-danger" : "text-primary"} uppercase text-[10px] font-['Space_Grotesk']`}
                    >
                      {user.is_active ? "Заблокировать" : "Разблокировать"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Создать пользователя" testId="create-user-modal">
        <label className="flex flex-col gap-1 mb-3">
          <span className={FIELD_LABEL}>Логин</span>
          <input className={FIELD_INPUT} value={newUsername} onChange={(e) => setNewUsername(e.currentTarget.value)} />
        </label>
        <label className="flex flex-col gap-1 mb-3">
          <span className={FIELD_LABEL}>Пароль</span>
          <input type="password" className={FIELD_INPUT} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
        </label>
        <label className="flex flex-col gap-1 mb-4">
          <span className={FIELD_LABEL}>Роль</span>
          <select className={FIELD_INPUT} value={newRole} onChange={(e) => setNewRole(e.currentTarget.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <div className="flex justify-end gap-3">
          <button onClick={() => setCreateOpen(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button
            onClick={async () => {
              try {
                await accountsApi.createUser(newUsername, newPassword, newRole);
                setUsers(await accountsApi.listUsers());
                setCreateOpen(false);
                setNewUsername("");
                setNewPassword("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Не удалось создать пользователя");
              }
            }}
            className={PRIMARY_BUTTON}
          >
            Создать
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** /settings/models-dir — «Модели и диск»: the models directory lives in
 * download settings (GET/PATCH /downloads/settings). */
const MIB = 1024 * 1024;

export function ModelsDirSettingsPage() {
  const [modelsDir, setModelsDir] = useState("");
  const [rateLimitMiB, setRateLimitMiB] = useState("0");
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Смена каталога не переписывает пути записей молча: оркестратор
  // сообщает, сколько их осталось в прежнем каталоге, а перевод —
  // отдельное действие здесь же.
  const [orphaned, setOrphaned] = useState<{ count: number; previousDir: string } | null>(null);
  const [relocating, setRelocating] = useState(false);
  const [relocationMessage, setRelocationMessage] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .getDownloadSettings()
      .then((s) => {
        setModelsDir(s.models_dir);
        setRateLimitMiB(String(Math.round((s.rate_limit_bytes_per_sec / MIB) * 100) / 100));
        setMaxConcurrent(String(s.max_concurrent_downloads));
      })
      .catch(() => setError("Не удалось загрузить настройку"));
  }, []);

  async function handleSave() {
    try {
      const updated = await orchestratorApi.updateDownloadSettings({
        models_dir: modelsDir,
        rate_limit_bytes_per_sec: Math.max(0, Math.round(Number(rateLimitMiB) * MIB)),
        max_concurrent_downloads: Math.max(1, Math.round(Number(maxConcurrent))),
      });
      setModelsDir(updated.models_dir);
      setRateLimitMiB(String(Math.round((updated.rate_limit_bytes_per_sec / MIB) * 100) / 100));
      setMaxConcurrent(String(updated.max_concurrent_downloads));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (updated.orphaned_models && updated.previous_models_dir) {
        setOrphaned({ count: updated.orphaned_models, previousDir: updated.previous_models_dir });
        setRelocationMessage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    }
  }

  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Модели и диск" />

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Каталог моделей</h2>
        <label className="flex flex-col gap-1 text-sm mb-4">
          <span className={FIELD_LABEL}>Путь на диске</span>
          <input className={FIELD_INPUT} value={modelsDir} onChange={(e) => setModelsDir(e.currentTarget.value)} />
        </label>

        {orphaned && (
          <div className="border border-warn text-warn p-3 mb-4 text-xs font-mono" data-testid="orphaned-models-warning">
            <p>
              Записей моделей с путями в прежнем каталоге: {orphaned.count}. Они останутся негодными, пока их путь
              указывает в {orphaned.previousDir}.
            </p>
            <button
              type="button"
              data-testid="relocate-models"
              disabled={relocating}
              onClick={async () => {
                setRelocating(true);
                try {
                  const result = await orchestratorApi.relocateModels(orphaned.previousDir);
                  setRelocationMessage(
                    `переведено: ${result.moved.length}; осталось негодными: ${result.skipped.length}`
                  );
                  if (result.skipped.length === 0) setOrphaned(null);
                } catch {
                  setRelocationMessage("не удалось перевести записи");
                } finally {
                  setRelocating(false);
                }
              }}
              className="mt-2 px-3 py-1 border border-warn font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:bg-warn enabled:hover:text-black disabled:opacity-40"
            >
              {relocating ? "Перевод…" : "Перевести записи"}
            </button>
            {relocationMessage && (
              <p className="mt-2 text-neutral-300" data-testid="relocation-message">
                {relocationMessage}
              </p>
            )}
          </div>
        )}

        <h2 className={SECTION_TITLE}>Загрузка</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Потолок скорости, МБ/с — общий на все закачки (0 — без ограничения)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              className={FIELD_INPUT}
              value={rateLimitMiB}
              onChange={(e) => setRateLimitMiB(e.currentTarget.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Одновременных закачек</span>
            <input
              type="number"
              min="1"
              step="1"
              className={FIELD_INPUT}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.currentTarget.value)}
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSave} className={PRIMARY_BUTTON}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        </div>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Каталог применяется к новым загрузкам; уже скачанные файлы не перемещаются. Потолок скорости — общий бюджет на все активные закачки: он делится между ними поровну и пересчитывается, когда их число меняется.
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}

/** Shared loader for the two pages that split /resources/settings between
 * them — each PATCH sends the full payload, so a page loads current values
 * and only changes its own fields (design: no neighbor-field loss). */
export function useResourceSettings() {
  const [settings, setSettings] = useState<{
    cpu_pool: number[];
    gpu_pool: number[];
    port_range_start: number;
    port_range_end: number;
    disk_ceiling_bytes_per_sec: number;
    net_ceiling_bytes_per_sec: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    orchestratorApi
      .getResourceSettings()
      .then(setSettings)
      .catch(() => setError("Не удалось загрузить настройки ресурсов"));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { settings, setSettings, error, setError, reload };
}

/** /settings/network — «Сеть и порты»: the TCP port range for inferences. */
export function NetworkSettingsPage() {
  const { settings, setSettings, error, setError } = useResourceSettings();
  const [portStart, setPortStart] = useState("");
  const [portEnd, setPortEnd] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setPortStart(String(settings.port_range_start));
      setPortEnd(String(settings.port_range_end));
    }
  }, [settings]);

  async function handleSave() {
    if (!settings) return;
    try {
      const updated = await orchestratorApi.updateResourceSettings({
        ...settings,
        port_range_start: Number(portStart),
        port_range_end: Number(portEnd),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить диапазон портов");
    }
  }

  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Сеть и порты" />

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Диапазон портов inference</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Начало диапазона</span>
            <input className={FIELD_INPUT} value={portStart} onChange={(e) => setPortStart(e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Конец диапазона</span>
            <input className={FIELD_INPUT} value={portEnd} onChange={(e) => setPortEnd(e.currentTarget.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={!settings} className={PRIMARY_BUTTON}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        </div>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Новый запуск берёт свободный порт из диапазона; уже запущенные inference не переключаются.
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}

/** /settings/cpu-gpu — «Пул CPU / GPU» (issue #20): блок «Информация о
 * системе» над выбором ресурсов — процессор, все видеокарты с наименованиями
 * и текущей доступностью, свободное ОЗУ; пулы выбираются checkbox'ами всех
 * обнаруженных ядер (по NUMA-узлам) и карт, а не вслепую текстом. */
export function CpuGpuSettingsPage() {
  const { settings, setSettings, error, setError } = useResourceSettings();
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [selectedCpus, setSelectedCpus] = useState<Set<number>>(new Set());
  const [selectedGpus, setSelectedGpus] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    orchestratorApi
      .getHardwareInfo()
      .then(setHardware)
      .catch(() => setHardware(null));
  }, []);

  useEffect(() => {
    if (settings) {
      setSelectedCpus(new Set(settings.cpu_pool));
      setSelectedGpus(new Set(settings.gpu_pool));
    }
  }, [settings]);

  // Все ядра стенда из NUMA-топологии (issue #20: «список доступных ядер»).
  const allCpus = Object.entries(hardware?.numa_topology ?? {}).flatMap(([node, cpus]) =>
    cpus.map((cpuId) => ({ node: Number(node), cpuId }))
  );
  const allGpus = hardware?.gpus ?? [];

  function toggleCpu(cpuId: number) {
    setSelectedCpus((prev) => {
      const next = new Set(prev);
      if (next.has(cpuId)) next.delete(cpuId);
      else next.add(cpuId);
      return next;
    });
  }

  function toggleGpu(gpuId: number) {
    setSelectedGpus((prev) => {
      const next = new Set(prev);
      if (next.has(gpuId)) next.delete(gpuId);
      else next.add(gpuId);
      return next;
    });
  }

  async function handleSave() {
    if (!settings) return;
    try {
      const updated = await orchestratorApi.updateResourceSettings({
        ...settings,
        cpu_pool: [...selectedCpus],
        gpu_pool: [...selectedGpus],
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить пулы");
    }
  }

  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Пул CPU / GPU" />

      {/* Информация о системе — выше выбора ресурсов (issue #20). */}
      <section className="bg-surface-container-lowest tactical-accent p-6 mb-6" data-testid="hardware-info">
        <h2 className={SECTION_TITLE}>Информация о системе</h2>

        {!hardware && <p className="text-xs text-neutral-500 font-mono">Загрузка информации о железе…</p>}

        {hardware && (
          <div className="flex flex-col gap-5 text-sm">
            <div className="grid grid-cols-[200px_1fr] gap-y-2 text-[11px] font-['Inter']">
              <div className="text-neutral-500 uppercase">Процессор</div>
              <div className="text-on-surface font-mono">{hardware.cpu.model_name}</div>
              <div className="text-neutral-500 uppercase">Ядер</div>
              <div className="text-on-surface font-mono">{hardware.cpu.core_count}</div>
              <div className="text-neutral-500 uppercase">ОЗУ</div>
              <div className="text-on-surface font-mono">
                {formatBytes(hardware.ram.available_bytes)} свободно из {formatBytes(hardware.ram.total_bytes)}
              </div>
            </div>

            {hardware.gpus && hardware.gpus.length > 0 && (
              <div>
                <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">Видеокарты</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {hardware.gpus.map((gpu) => (
                    <div key={gpu.gpu_id} className="bg-surface-container p-3 text-[11px] font-mono">
                      <div className="flex justify-between mb-1">
                        <span className="font-['Space_Grotesk'] font-bold text-on-surface">
                          GPU {gpu.gpu_id} · {gpu.name}
                        </span>
                        <span className="text-neutral-500">{gpu.temperature_c}°C</span>
                      </div>
                      <div className="flex justify-between text-neutral-400">
                        <span>
                          VRAM: {formatBytes(gpu.used_bytes)} / {formatBytes(gpu.total_bytes)}
                        </span>
                        <span className="text-neutral-500">util {gpu.utilization_percent}%</span>
                      </div>
                      <div className="h-1 bg-neutral-800 mt-1.5">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${gpu.total_bytes ? Math.round((100 * gpu.used_bytes) / gpu.total_bytes) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hardware.gpus !== null && hardware.gpus.length === 0 && (
              <div className="text-[11px] text-neutral-500 font-mono">Видеокарты не обнаружены.</div>
            )}

            {hardware.gpus === null && hardware.nvml_error && (
              <div className="text-[11px] text-warn font-mono">⚠ {hardware.nvml_error}</div>
            )}
          </div>
        )}
      </section>

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Пул ресурсов</h2>

        {/* GPU чекбоксы — общий компонент со страницей inference */}
        {allGpus.length > 0 && (
          <div className="mb-5">
            <GpuChecklist items={allGpus} selected={selectedGpus} onToggle={toggleGpu} />
          </div>
        )}

        {/* CPU чекбоксы по NUMA-узлам */}
        {allCpus.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
              Ядра процессора ({selectedCpus.size} из {allCpus.length} выбрано)
            </div>
            <div className="flex flex-col gap-3">
              {Object.entries(hardware?.numa_topology ?? {}).map(([node, cpus]) => (
                <div key={node}>
                  <div className="text-[10px] text-neutral-600 uppercase font-mono mb-1">CPU node {node}</div>
                  <div className="flex flex-wrap gap-2">
                    {cpus.map((cpuId) => (
                      <label
                        key={cpuId}
                        className="flex items-center gap-1.5 text-xs text-neutral-300 bg-surface-container px-2 py-1 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selectedCpus.has(cpuId)}
                          onChange={() => toggleCpu(cpuId)}
                          data-testid={`cpu-checkbox-${cpuId}`}
                        />
                        {cpuId}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hardware && <p className="text-xs text-neutral-500 font-mono">Ожидание информации о железе…</p>}

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={!settings} className={PRIMARY_BUTTON}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        </div>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Изменение пула CPU влияет на новые запуски (AllowedCPUs транзиентного юнита).
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}

/** Re-exported for the hub's assistant status line. */
export { StatusBadge };

/** /settings/inference — «Inference»: политика хранения журналов запусков.
 * Срок и число живут вместе с остальными лимитами истории — чистка одна, и
 * разносить её параметры по двум местам значило бы завести второй источник
 * правды о хранении. */
export function InferenceSettingsPage() {
  const [settings, setSettings] = useState<HistorySettings | null>(null);
  const [maxLogAgeDays, setMaxLogAgeDays] = useState("");
  const [maxLogFiles, setMaxLogFiles] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .getHistorySettings()
      .then((loaded) => {
        setSettings(loaded);
        setMaxLogAgeDays(String(loaded.max_log_age_days));
        setMaxLogFiles(String(loaded.max_log_files));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить настройки"));
  }, []);

  async function handleSave() {
    try {
      const updated = await orchestratorApi.updateHistorySettings({
        max_log_age_days: Number(maxLogAgeDays),
        max_log_files: Number(maxLogFiles),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить политику хранения журналов");
    }
  }

  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Inference" />

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Хранение журналов запусков</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Максимальный срок хранения, дней</span>
            <input
              className={FIELD_INPUT}
              value={maxLogAgeDays}
              onChange={(e) => setMaxLogAgeDays(e.currentTarget.value)}
              data-testid="max-log-age-days"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Максимальное число журналов</span>
            <input
              className={FIELD_INPUT}
              value={maxLogFiles}
              onChange={(e) => setMaxLogFiles(e.currentTarget.value)}
              data-testid="max-log-files"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={settings === null} className={PRIMARY_BUTTON}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        </div>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Журнал старше срока или сверх числа удаляется при следующем старте оркестратора; запись запуска
          остаётся с пометкой об отсутствии журнала.
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}
