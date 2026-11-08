import { useEffect, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import { FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "../../components/ui";

/** reference/settings — «Хранение и помощник» tile / «Хранение истории»
 * field in the read-only summary panel. Never built as an editable form
 * (plugin-and-engine-management-ui task 4.4: "Форма: политика хранения
 * истории/логов" — the backend settings existed since run-history-and-logs,
 * router-openai-compatible-api and audit-log-middleware, but no SPA page
 * ever called getHistorySettings/getRequestLogSettings/getAuditSettings). */
export function RetentionSettingsSection() {
  const [historyMaxRecords, setHistoryMaxRecords] = useState("");
  const [historyMaxBytes, setHistoryMaxBytes] = useState("");
  const [requestLogMaxRecords, setRequestLogMaxRecords] = useState("");
  const [auditMaxRecords, setAuditMaxRecords] = useState("");
  // Политика хранения метрик живёт здесь же, а не на своей странице:
  // оператор ищет её там, где уже задаёт хранение логов и журналов.
  const [metricsRawHours, setMetricsRawHours] = useState("");
  const [metricsAggregateDays, setMetricsAggregateDays] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .getHistorySettings()
      .then((s) => {
        setHistoryMaxRecords(String(s.max_records_per_profile));
        setHistoryMaxBytes(String(s.max_total_log_bytes));
      })
      .catch(() => setError("Не удалось загрузить политику хранения истории"));
    orchestratorApi
      .getRequestLogSettings()
      .then((s) => setRequestLogMaxRecords(String(s.max_records)))
      .catch(() => setError("Не удалось загрузить политику хранения журнала запросов"));
    orchestratorApi
      .getAuditSettings()
      .then((s) => setAuditMaxRecords(String(s.max_records)))
      .catch(() => setError("Не удалось загрузить политику хранения аудита"));
    orchestratorApi
      .getMetricsSettings()
      .then((s) => {
        setMetricsRawHours(String(s.raw_retention_hours));
        setMetricsAggregateDays(String(s.aggregate_retention_days));
      })
      .catch(() => setError("Не удалось загрузить политику хранения метрик"));
  }, []);

  async function handleSave() {
    setError(null);
    try {
      await Promise.all([
        orchestratorApi.updateHistorySettings({
          max_records_per_profile: Number(historyMaxRecords),
          max_total_log_bytes: Number(historyMaxBytes),
        }),
        orchestratorApi.updateRequestLogSettings(Number(requestLogMaxRecords)),
        orchestratorApi.updateAuditSettings(Number(auditMaxRecords)),
        orchestratorApi.updateMetricsSettings({
          raw_retention_hours: Number(metricsRawHours),
          aggregate_retention_days: Number(metricsAggregateDays),
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить политику хранения");
    }
  }

  return (
    <section className="bg-surface-container-lowest p-6 mb-6" data-testid="retention-settings">
      <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary mb-4">
        Хранение истории, логов и метрик
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>История запусков — записей на профиль</span>
          <input
            className={FIELD_INPUT}
            value={historyMaxRecords}
            onChange={(e) => setHistoryMaxRecords(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>История запусков — лимит логов, байт</span>
          <input
            className={FIELD_INPUT}
            value={historyMaxBytes}
            onChange={(e) => setHistoryMaxBytes(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Журнал запросов роутера — записей</span>
          <input
            className={FIELD_INPUT}
            value={requestLogMaxRecords}
            onChange={(e) => setRequestLogMaxRecords(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Журнал аудита — записей</span>
          <input
            className={FIELD_INPUT}
            value={auditMaxRecords}
            onChange={(e) => setAuditMaxRecords(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Метрики — сырые отсчёты, часов</span>
          <input
            className={FIELD_INPUT}
            data-testid="metrics-raw-retention"
            value={metricsRawHours}
            onChange={(e) => setMetricsRawHours(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Метрики — минутные агрегаты, суток</span>
          <input
            className={FIELD_INPUT}
            data-testid="metrics-aggregate-retention"
            value={metricsAggregateDays}
            onChange={(e) => setMetricsAggregateDays(e.currentTarget.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className={PRIMARY_BUTTON}>
          Сохранить
        </button>
        {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        {error && <span className="text-xs text-danger font-mono">{error}</span>}
      </div>
    </section>
  );
}
