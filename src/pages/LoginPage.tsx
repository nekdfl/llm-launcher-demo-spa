import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { FIELD_INPUT } from "../components/ui";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch {
      setError("Неверный логин или пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface-container-lowest tactical-accent p-8">
        <h1 className="text-xl font-bold tracking-tighter text-primary font-['Space_Grotesk'] uppercase mb-6">
          LLM_LAUNCHER
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500 uppercase font-['Space_Grotesk']">Логин</span>
            <input
              className={FIELD_INPUT}
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500 uppercase font-['Space_Grotesk']">Пароль</span>
            <input
              type="password"
              className={FIELD_INPUT}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
            />
          </label>
          {error && <div className="text-xs text-danger font-mono">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 px-4 py-3 bg-primary text-black text-xs font-['Space_Grotesk'] font-bold uppercase hover:bg-primary/80 disabled:opacity-50"
          >
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
