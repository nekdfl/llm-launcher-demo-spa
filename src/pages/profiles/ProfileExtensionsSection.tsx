import { useEffect, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import type { EngineExtension, ExtensionSelection } from "../../api/types";
import { INHERITED_BLOCK, InheritanceMark } from "../../components/InheritanceMark";
import { SchemaField } from "../../components/SchemaField";
import { extensionOverridden } from "../../lib/launchParams";
import { CHECKBOX, FIELD_HINT, SECTION_CARD, SECTION_TITLE, selectTile, selectTileLabel } from "../../components/ui";

/** Начальные значения опций включаемого расширения — умолчания манифеста. */
function defaultOptions(extension: EngineExtension): Record<string, unknown> {
  return Object.fromEntries(
    extension.options.filter((o) => o.default !== null && o.default !== undefined).map((o) => [o.name, o.default])
  );
}

/** Раздел «Расширения» формы профиля: переключатель на каждое готовое
 * расширение плагина и поля его опций по дескрипторам манифеста. Ошибочные
 * расширения не предлагаются; без расширений раздел не показывается.
 * `fieldError` — ошибка сервера с путём `extensions.<имя>[.<опция>]`.
 * `profileValue` — выбор профиля: у inference каждое расширение сравнивается
 * с ним и получает пометку «из профиля» / «переопределено». */
export function ProfileExtensionsSection({
  pluginId,
  value,
  onChange,
  fieldError,
  profileValue,
}: {
  pluginId: number | null;
  value: ExtensionSelection;
  onChange: (value: ExtensionSelection) => void;
  fieldError: { field: string; message: string } | null;
  profileValue?: ExtensionSelection;
}) {
  const [extensions, setExtensions] = useState<EngineExtension[]>([]);

  useEffect(() => {
    if (!pluginId) {
      setExtensions([]);
      return;
    }
    let cancelled = false;
    orchestratorApi
      .getPluginSchema(pluginId)
      .then((schema) => {
        if (!cancelled) setExtensions((schema.extensions ?? []).filter((e) => e.status === "ok"));
      })
      .catch(() => {
        if (!cancelled) setExtensions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  if (extensions.length === 0) return null;

  function errorFor(path: string): string | null {
    return fieldError && fieldError.field === path ? fieldError.message : null;
  }

  return (
    <section className={SECTION_CARD} data-testid="profile-extensions">
      <h2 className={SECTION_TITLE}>Расширения</h2>
      <div className="flex flex-col gap-4">
        {extensions.map((extension) => {
          const enabled = extension.name in value;
          const overridden = profileValue ? extensionOverridden(value, profileValue, extension.name) : true;
          const resetToProfile = () => {
            const next = { ...value };
            if (profileValue && extension.name in profileValue) next[extension.name] = structuredClone(profileValue[extension.name]);
            else delete next[extension.name];
            onChange(next);
          };
          return (
            <div key={extension.id} className={`${selectTile(enabled)} !cursor-default p-3 ${overridden ? "" : INHERITED_BLOCK}`}>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={enabled}
                  data-testid={`extension-toggle-${extension.name}`}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.currentTarget.checked) next[extension.name] = defaultOptions(extension);
                    else delete next[extension.name];
                    onChange(next);
                  }}
                />
                <span className={`font-['Space_Grotesk'] ${selectTileLabel(enabled)}`}>{extension.name}</span>
                <span className={FIELD_HINT}>
                  v{extension.version} · {extension.task}
                </span>
              </label>
              {profileValue && (
                <div className="text-[10px] font-mono mt-1">
                  <InheritanceMark overridden={overridden} onReset={resetToProfile} testId={`inherit-extension-${extension.name}`} />
                </div>
              )}
              {errorFor(`extensions.${extension.name}`) && (
                <div className="text-[10px] text-danger font-mono mt-1">{errorFor(`extensions.${extension.name}`)}</div>
              )}
              {enabled && extension.options.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-3">
                  {extension.options.map((option) => (
                    <SchemaField
                      key={option.name}
                      field={option}
                      value={value[extension.name]?.[option.name]}
                      error={errorFor(`extensions.${extension.name}.${option.name}`)}
                      testId={`extension-option-${extension.name}-${option.name}`}
                      onChange={(optionValue) =>
                        onChange({ ...value, [extension.name]: { ...value[extension.name], [option.name]: optionValue } })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
