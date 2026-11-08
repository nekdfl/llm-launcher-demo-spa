import { useEffect, useState } from "react";
import { accountsApi } from "../../api/accounts";
import { orchestratorApi } from "../../api/orchestrator";
import type { ApiKeyCreated, ApiKeyRecord, Inference, RequestLogEntry } from "../../api/types";
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

/** "22 февраля 2026 года" from an <input type="date"> value ("" or
 * yyyy-mm-dd, both always well-formed per the native input itself —
 * router-api-key-acl-and-expiry: no separate manual format validation). */
function formatDateRu(isoDate: string): string {
  if (!isoDate) return "";
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  // ru-RU with year:"numeric" appends its own "г." — formatting day+month
  // only and appending "года" ourselves avoids "...2026 г. года".
  const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parsed);
  return `${dayMonth} ${parsed.getFullYear()} года`;
}

/** navigator.clipboard only exists in a secure context (HTTPS, or
 * localhost/127.0.0.1) — this stand is typically reached over plain HTTP by
 * LAN IP, where it's simply undefined, not just permission-denied. Falls
 * back to the classic hidden-textarea + execCommand("copy") trick, which
 * still works over plain HTTP. */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("не удалось скопировать (execCommand отклонён браузером)");
  } finally {
    document.body.removeChild(textarea);
  }
}

/** reference/router — API keys (create shows the raw key exactly once, spec)
 * and the request log (bodies are never stored). */
export function RouterPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [log, setLog] = useState<RequestLogEntry[]>([]);
  const [inferences, setInferences] = useState<Inference[]>([]);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedInferenceIds, setSelectedInferenceIds] = useState<string[]>([]);
  const [expiryDate, setExpiryDate] = useState("");
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyRecord | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    orchestratorApi
      .listInferences()
      .then(setInferences)
      .catch(() => setInferences([]));
  }, []);

  function refresh() {
    orchestratorApi
      .listApiKeys()
      .then(setKeys)
      .catch(() => setKeys([]));
    orchestratorApi
      .listRequestLog(50)
      .then(setLog)
      .catch(() => setLog([]));
  }

  function openCreateForm() {
    setSelectedInferenceIds([]);
    setExpiryDate("");
    setError(null);
    setShowCreateForm(true);
  }

  function toggleInference(id: string) {
    setSelectedInferenceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function createKey() {
    try {
      const username = localStorage.getItem("llm_launcher_username") ?? "admin";
      const expiresAt = expiryDate ? `${expiryDate}T00:00:00` : null;
      const key = await orchestratorApi.createApiKey(username, selectedInferenceIds, expiresAt);
      setShowCreateForm(false);
      setCopied(false);
      setError(null);
      setCreated(key);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать ключ");
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await copyToClipboard(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось скопировать ключ");
    }
  }

  async function confirmRevoke() {
    if (!keyToRevoke) return;
    try {
      await orchestratorApi.revokeApiKey(keyToRevoke.id);
      setKeyToRevoke(null);
      refresh();
    } catch (err) {
      setKeyToRevoke(null);
      setError(err instanceof Error ? err.message : "Не удалось отозвать ключ");
    }
  }

  async function confirmDelete() {
    if (!keyToDelete) return;
    try {
      await orchestratorApi.deleteApiKey(keyToDelete.id);
      setKeyToDelete(null);
      refresh();
    } catch (err) {
      setKeyToDelete(null);
      setError(err instanceof Error ? err.message : "Не удалось удалить ключ");
    }
  }

  const maskKey = (prefix: string) => {
    const visible = prefix.slice(-4);
    return `sk-llm-••••${visible}`;
  };

  return (
    <div>
      <PageHeader pulse title="Роутер">
        <div className="text-xs font-mono text-neutral-500">
          base URL: <span className="text-primary">http://&lt;стенд&gt;:8899/v1</span>
        </div>
      </PageHeader>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <section className={SECTION_CARD}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={SECTION_TITLE}>API-ключи</h2>
          <button onClick={openCreateForm} className={PRIMARY_BUTTON}>
            Создать ключ
          </button>
        </div>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
              <th className="text-left py-2 font-normal">Ключ</th>
              <th className="text-left font-normal">Пользователь</th>
              <th className="text-left font-normal">Статус</th>
              <th className="text-left font-normal">Создан</th>
              <th className="text-left font-normal"></th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-neutral-900">
                <td className="py-2">{maskKey(key.key_prefix)}</td>
                <td>{key.owner_username}</td>
                <td className={key.revoked_at === null ? "text-primary" : "text-neutral-500"}>
                  {key.revoked_at === null ? "активен" : "отозван"}
                </td>
                <td>{new Date(key.created_at).toLocaleDateString("ru-RU")}</td>
                <td>
                  {key.revoked_at === null ? (
                    <button
                      onClick={() => setKeyToRevoke(key)}
                      className="text-danger uppercase text-[10px] font-['Space_Grotesk']"
                    >
                      Отозвать
                    </button>
                  ) : (
                    <button
                      onClick={() => setKeyToDelete(key)}
                      className="text-danger uppercase text-[10px] font-['Space_Grotesk']"
                    >
                      Удалить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys.length === 0 && <p className="text-xs text-neutral-500 font-mono mt-3">Ключей пока нет.</p>}
      </section>

      <section className="bg-surface-container-lowest p-6">
        <h2 className={`${SECTION_TITLE} mb-4`}>
          Журнал запросов <span className="text-neutral-600 normal-case font-normal">(тела не хранятся)</span>
        </h2>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
              <th className="text-left py-2 font-normal">Время</th>
              <th className="text-left font-normal">Inference</th>
              <th className="text-left font-normal">Токены</th>
              <th className="text-left font-normal">Длительность</th>
              <th className="text-left font-normal">Код</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {log.map((entry) => (
              <tr key={entry.id} className="border-b border-neutral-900">
                <td className="py-2">{new Date(entry.started_at).toLocaleTimeString("ru-RU")}</td>
                <td>{entry.inference_id ?? "—"}</td>
                <td>
                  {entry.tokens_in ?? "—"} / {entry.tokens_out ?? "—"}
                </td>
                <td>{entry.duration_ms !== null ? `${(entry.duration_ms / 1000).toFixed(1)}с` : "—"}</td>
                <td className={entry.status_code < 400 ? "text-primary" : "text-danger"}>{entry.status_code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length === 0 && <p className="text-xs text-neutral-500 font-mono mt-3">Записей пока нет.</p>}
      </section>

      <Modal open={showCreateForm} onClose={() => setShowCreateForm(false)} title="Создание ключа" testId="create-key-modal">
        <div className="mb-4">
          <span className={FIELD_LABEL}>Доступ к моделям</span>
          <div className="text-[10px] text-neutral-600 font-mono mb-2">
            Ничего не отмечено — ключ получит доступ ко всем моделям (в т.ч. будущим)
          </div>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {inferences.map((inference) => (
              <label key={inference.id} className="flex items-center gap-2 text-xs font-mono text-neutral-300">
                <input
                  type="checkbox"
                  checked={selectedInferenceIds.includes(inference.id)}
                  onChange={() => toggleInference(inference.id)}
                />
                {inference.name}
              </label>
            ))}
            {inferences.length === 0 && <p className="text-xs text-neutral-500 font-mono">Inference пока нет.</p>}
          </div>
        </div>

        <div className="mb-4">
          <span className={FIELD_LABEL}>Срок действия</span>
          <div className="text-[10px] text-neutral-600 font-mono mb-2">Не выбрано — ключ бессрочный</div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              className={FIELD_INPUT}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.currentTarget.value)}
              data-testid="expiry-date-input"
            />
            <span className="text-xs text-neutral-400 font-mono" data-testid="expiry-date-label">
              {expiryDate ? formatDateRu(expiryDate) : "без ограничения"}
            </span>
          </div>
        </div>

        {error && <p className="text-xs text-danger font-mono mb-3">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowCreateForm(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={createKey} className={PRIMARY_BUTTON}>
            Создать
          </button>
        </div>
      </Modal>

      <Modal
        open={keyToRevoke !== null}
        onClose={() => setKeyToRevoke(null)}
        title="Вы действительно хотите отозвать ключ?"
        tone="danger"
        testId="revoke-key-modal"
      >
        <div className="text-xs text-neutral-300 mb-5">
          Ключ <span className="font-mono text-neutral-100">{keyToRevoke ? maskKey(keyToRevoke.key_prefix) : ""}</span>{" "}
          перестанет работать немедленно. Отменить это действие нельзя.
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setKeyToRevoke(null)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={confirmRevoke} className="px-4 py-2 bg-danger text-black font-['Space_Grotesk'] text-xs font-bold uppercase">
            Да, отозвать
          </button>
        </div>
      </Modal>

      <Modal
        open={keyToDelete !== null}
        onClose={() => setKeyToDelete(null)}
        title="Удалить ключ безвозвратно?"
        tone="danger"
        testId="delete-key-modal"
      >
        <div className="text-xs text-neutral-300 mb-5">
          Ключ <span className="font-mono text-neutral-100">{keyToDelete ? maskKey(keyToDelete.key_prefix) : ""}</span>{" "}
          будет полностью удалён из базы. Восстановить запись нельзя.
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setKeyToDelete(null)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={confirmDelete} className="px-4 py-2 bg-danger text-black font-['Space_Grotesk'] text-xs font-bold uppercase">
            Да, удалить
          </button>
        </div>
      </Modal>

      <Modal open={created !== null} onClose={() => setCreated(null)} title="Ключ создан" testId="created-key-modal">
        <div className="text-xs text-neutral-300 mb-2">Значение ключа показывается один раз — скопируйте его сейчас:</div>
        <div className="flex items-center gap-2 mb-4">
          <code className="flex-1 bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs text-primary break-all">
            {created?.key}
          </code>
          <button
            onClick={copyKey}
            title="Скопировать в буфер обмена"
            aria-label="Скопировать в буфер обмена"
            data-testid="copy-key-button"
            className="shrink-0 p-2 border border-neutral-700 text-neutral-300 hover:border-primary hover:text-primary"
          >
            <span className="material-symbols-outlined text-lg leading-none">
              {copied ? "check" : "content_copy"}
            </span>
          </button>
        </div>
        {copied && <div className="text-[10px] text-primary font-mono mb-3">Скопировано</div>}
        {error && <p className="text-xs text-danger font-mono mb-3">{error}</p>}
        <div className="flex justify-end">
          <button onClick={() => setCreated(null)} className={GHOST_BUTTON}>
            Готово
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Small helper used by SettingsPage too — same role probe. */
export async function currentUserIsAdmin(): Promise<boolean> {
  return accountsApi.isAdmin();
}

export { StatusBadge, FIELD_LABEL, FIELD_INPUT };
