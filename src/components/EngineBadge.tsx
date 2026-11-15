import { useEffect, useState } from "react";
import { orchestratorApi } from "../api/orchestrator";
import type { PluginRecord } from "../api/types";

/** Бейдж движка в шапке «Параметры запуска»: вариант движка (engine-плагин)
 * и версия, по которой строится «Команда запуска». */
export function EngineBadge({ pluginId }: { pluginId: number | null }) {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);

  useEffect(() => {
    orchestratorApi
      .listPlugins()
      .then(setPlugins)
      .catch(() => setPlugins([]));
  }, []);

  const plugin = plugins.find((item) => item.id === pluginId);
  if (!plugin) return null;

  return (
    <span className="px-2 py-0.5 border border-neutral-700 text-[11px] font-mono text-neutral-400 normal-case tracking-normal" data-testid="engine-badge">
      {plugin.name}
      {plugin.engine_version ? ` · ${plugin.engine_version}` : ""}
    </span>
  );
}
