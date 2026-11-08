import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { accountsApi } from "../../api/accounts";
import { orchestratorApi } from "../../api/orchestrator";
import type { SystemUser, HistorySettings } from "../../api/types";
import { PageHeader } from "../../components/ui";
import { formatBytes } from "../../lib/formatBytes";

interface HubCard {
  to: string;
  icon: string;
  title: string;
  description: string;
  footer: string;
}

/** /settings — bento hub (reference/settings). Every card is a real route
 * link (UI-BEHAVIOR §1: клик по карточке — отдельная страница), the «Сводка
 * системы» panel below is read-only overview; all editing happens on the
 * subpages. */
export function SettingsPage() {
  const [numa, setNuma] = useState<Record<string, number[]>>({});
  const [resourceSettings, setResourceSettings] = useState<{
    cpu_pool: number[];
    gpu_pool: number[];
    port_range_start: number;
    port_range_end: number;
    disk_ceiling_bytes_per_sec: number;
    net_ceiling_bytes_per_sec: number;
  } | null>(null);
  const [modelsDir, setModelsDir] = useState("");
  const [users, setUsers] = useState<SystemUser[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [assistantModel, setAssistantModel] = useState("");
  const [historySettings, setHistorySettings] = useState<HistorySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [topology, settings, downloadSettings] = await Promise.allSettled([
        orchestratorApi.getNumaTopology(),
        orchestratorApi.getResourceSettings(),
        orchestratorApi.getDownloadSettings(),
      ]);
      if (topology.status === "fulfilled") setNuma(topology.value);
      if (settings.status === "fulfilled") setResourceSettings(settings.value);
      if (downloadSettings.status === "fulfilled") setModelsDir(downloadSettings.value.models_dir);
      if (topology.status === "rejected" && settings.status === "rejected") {
        setError("Не удалось загрузить настройки");
      }
      try {
        const assistant = await orchestratorApi.getAssistantSettings();
        setAssistantConfigured(assistant.configured);
        setAssistantModel(assistant.model);
      } catch {
        setAssistantConfigured(false);
      }
      try {
        setHistorySettings(await orchestratorApi.getHistorySettings());
      } catch {
        setHistorySettings(null);
      }
      setIsAdmin(await accountsApi.isAdmin());
      if (await accountsApi.isAdmin()) {
        accountsApi
          .listUsers()
          .then(setUsers)
          .catch(() => setUsers(null));
      }
    })();
  }, []);

  const cards: HubCard[] = [
    {
      to: "/settings/users",
      icon: "group",
      title: "Пользователи",
      description: "Учётные записи, роли, блокировка",
      footer: users ? `${users.filter((u) => u.is_active).length} активных` : isAdmin ? "…" : "только admin",
    },
    {
      to: "/settings/models-dir",
      icon: "database",
      title: "Модели и диск",
      description: "Каталог моделей, свободное место",
      footer: modelsDir || "…",
    },
    {
      to: "/settings/network",
      icon: "settings_ethernet",
      title: "Сеть и порты",
      description: "Диапазон портов",
      footer: resourceSettings ? `${resourceSettings.port_range_start}–${resourceSettings.port_range_end}` : "…",
    },
    {
      to: "/settings/cpu-gpu",
      icon: "developer_board",
      title: "Пул CPU / GPU",
      description: "Ядра по NUMA-узлам, видеокарты",
      footer: `${Object.keys(numa).length} NUMA-узлов`,
    },
    {
      to: "/settings/inference",
      icon: "manage_history",
      title: "Inference",
      description: "Хранение журналов запусков",
      footer: historySettings ? `${historySettings.max_log_files} журналов · ${historySettings.max_log_age_days} дн.` : "…",
    },
    {
      to: "/settings/assistant",
      icon: "smart_toy",
      title: "Хранение и помощник",
      description: "Ретеншн истории/логов, модель-помощник",
      footer: assistantConfigured ? assistantModel || "настроен" : "не настроен",
    },
  ];

  return (
    <div>
      <PageHeader pulse title="Настройки">
        <p className="font-['Inter'] text-xs text-neutral-500 tracking-widest uppercase">Параметры стенда, доступ и политики хранения</p>
      </PageHeader>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      {/* Bento hub — every card is a route link. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {cards.map((card) => (
          <HubCardLink key={card.to} card={card} />
        ))}
      </div>

      {/* Сводка системы — read-only overview (editing lives on subpages). */}
      <section id="system" className="bg-surface-container-lowest tactical-accent-top p-8 mb-12 scroll-mt-20" style={{ boxShadow: "inset 0 4px 0 0 #3ce36a" }}>
        <header className="mb-6 border-b border-neutral-900 pb-4">
          <h2 className="font-['Space_Grotesk'] text-lg font-bold uppercase text-primary tracking-widest">Сводка системы</h2>
          <p className="text-[10px] text-neutral-500 font-['Inter'] uppercase">Текущие параметры стенда // редактируются на страницах разделов</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-primary">lan</span>
              <h3 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-widest">Сеть и ресурсы</h3>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-y-2 text-[11px] font-['Inter']">
              <div className="text-neutral-500 uppercase">Каталог моделей</div>
              <div className="text-on-surface font-mono">{modelsDir || "—"}</div>
              <div className="text-neutral-500 uppercase">Диапазон портов</div>
              <div className="text-on-surface font-mono">
                {resourceSettings ? `${resourceSettings.port_range_start}–${resourceSettings.port_range_end}` : "—"}
              </div>
              {Object.entries(numa).map(([node, cpus]) => (
                <div key={node} className="contents">
                  <div className="text-neutral-500 uppercase">CPU node {node}</div>
                  <div className="text-on-surface font-mono">{cpus.length > 0 ? `${cpus[0]}-${cpus[cpus.length - 1]}` : "—"}</div>
                </div>
              ))}
              <div className="text-neutral-500 uppercase">GPU-пул</div>
              <div className="text-primary font-['Space_Grotesk'] font-bold">
                {resourceSettings ? `${resourceSettings.gpu_pool.length} GPU: ${resourceSettings.gpu_pool.join(", ")}` : "—"}
              </div>
              <div className="text-neutral-500 uppercase">Пул CPU</div>
              <div className="text-on-surface font-mono">
                {resourceSettings ? resourceSettings.cpu_pool.join(", ") : "—"}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-primary">schedule</span>
              <h3 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-widest">Жизненный цикл и хранение</h3>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-y-2 text-[11px] font-['Inter']">
              <div className="text-neutral-500 uppercase">Потолок диска</div>
              <div className="text-on-surface font-mono">
                {resourceSettings ? formatBytes(resourceSettings.disk_ceiling_bytes_per_sec) + "/с" : "—"}
              </div>
              <div className="text-neutral-500 uppercase">Потолок сети</div>
              <div className="text-on-surface font-mono">
                {resourceSettings ? formatBytes(resourceSettings.net_ceiling_bytes_per_sec) + "/с" : "—"}
              </div>
              <div className="text-neutral-500 uppercase">Хранение истории</div>
              <div className="text-on-surface font-mono">
                {historySettings ? `${historySettings.max_records_per_profile} записей / профиль` : "—"}
              </div>
              <div className="text-neutral-500 uppercase">Модель-помощник</div>
              <div className="text-primary font-['Space_Grotesk'] font-bold">
                {assistantConfigured ? assistantModel : "не настроен"}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function HubCardLink({ card }: { card: HubCard }) {
  return (
    <Link
      to={card.to}
      className="bg-surface-container-low tactical-accent p-6 flex flex-col justify-between group hover:bg-surface-container transition-colors"
    >
      <div className="flex justify-between items-start">
        <span className="material-symbols-outlined text-primary text-3xl">{card.icon}</span>
      </div>
      <div className="mt-8">
        <h3 className="font-['Space_Grotesk'] text-xl font-bold uppercase">{card.title}</h3>
        <p className="font-['Inter'] text-xs text-neutral-500 mt-1">{card.description}</p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-primary font-['Space_Grotesk'] text-xs font-bold uppercase">{card.footer}</span>
        <span className="material-symbols-outlined text-neutral-700 group-hover:text-primary transition-all translate-x-0 group-hover:translate-x-2">
          arrow_forward
        </span>
      </div>
    </Link>
  );
}
