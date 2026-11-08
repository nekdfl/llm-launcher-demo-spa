import { useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import { orchestratorApi, type RouterModelEntry } from "../api/orchestrator";
import { FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON, SECTION_TITLE } from "../components/ui";

const TASK_TTS = "text-to-speech";
const TASK_STT = "automatic-speech-recognition";

/** Консоль речевого inference (speech-voice-api): для TTS — синтез фразы с
 * выбором голоса и проигрыванием, для STT — загрузка файла и текст ответа.
 * У текстовых движков не показывается. Клиентам — голосовые маршруты роутера;
 * здесь — проверка из интерфейса. */
export function SpeechConsole({ inferenceId, running }: { inferenceId: string; running: boolean }) {
  const [entry, setEntry] = useState<RouterModelEntry | null>(null);
  const [text, setText] = useState("Привет! Это проверка синтеза речи.");
  const [voice, setVoice] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Promise.resolve: консоль — необязательная часть страницы, её сбой не
    // должен ронять остальной экран.
    Promise.resolve()
      .then(() => orchestratorApi.describeRouterModel(inferenceId))
      .then((value) => {
        if (cancelled) return;
        setEntry(value);
        if (value.supported_voices?.length) setVoice(value.supported_voices[0]);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inferenceId, running]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  if (!entry || (entry.task !== TASK_TTS && entry.task !== TASK_STT)) return null;
  const tts = entry.task === TASK_TTS;

  async function synthesize() {
    setBusy(true);
    setError(null);
    try {
      const blob = await orchestratorApi.synthesizeSpeech(inferenceId, text, voice || null);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(apiErrorMessage(err, "Синтез не удался"));
    } finally {
      setBusy(false);
    }
  }

  async function transcribe() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await orchestratorApi.transcribeAudio(inferenceId, file);
      setTranscript(result.text);
    } catch (err) {
      setError(apiErrorMessage(err, "Распознавание не удалось"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 bg-surface-container-lowest tactical-accent p-6" data-testid="speech-console">
      <h2 className={SECTION_TITLE}>{tts ? "Проверка синтеза" : "Проверка распознавания"}</h2>
      {!running && <p className="text-[11px] text-neutral-500 font-mono mb-3">inference не запущен</p>}
      {tts ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Текст</span>
            <textarea className={`${FIELD_INPUT} h-20`} value={text} onChange={(e) => setText(e.currentTarget.value)} />
          </label>
          {(entry.supported_voices?.length ?? 0) > 0 && (
            <label className="flex flex-col gap-1 max-w-xs">
              <span className={FIELD_LABEL}>Голос</span>
              <select className={FIELD_INPUT} value={voice} onChange={(e) => setVoice(e.currentTarget.value)}
                      data-testid="speech-voice">
                {entry.supported_voices!.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
          )}
          <div>
            <button className={PRIMARY_BUTTON} onClick={synthesize} disabled={!running || busy || !text.trim()}>
              {busy ? "Синтез…" : "Синтезировать"}
            </button>
          </div>
          {audioUrl && <audio controls src={audioUrl} data-testid="speech-audio" />}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Аудиофайл</span>
            <input type="file" accept="audio/*" data-testid="speech-file"
                   className="bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs"
                   onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
          </label>
          <div>
            <button className={PRIMARY_BUTTON} onClick={transcribe} disabled={!running || busy || !file}>
              {busy ? "Распознавание…" : "Распознать"}
            </button>
          </div>
          {transcript !== null && (
            <div className="bg-surface-container p-3 text-sm" data-testid="speech-transcript">{transcript}</div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-danger font-mono mt-3">{error}</p>}
    </section>
  );
}
