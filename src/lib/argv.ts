/** Разбор опций командной строки движка без потерь (design.md change
 * `launch-params-argv-editor`, «Разбор без потерь»).
 *
 * Плагины передают `cli_options` в argv через `shlex.split` (POSIX), а форму
 * записи диктует движок: llama-server не принимает `--k=v`, JSON-значения
 * идут в кавычках. Поэтому строки списка хранят исходный текст ключа и
 * значения, а сериализация его не переписывает. */

export type ArgvSeparator = " " | "=";

export interface ArgvRow {
  /** Ключ как записан (`--ctx-size`, `-ngl`, `-O3`); пустой — позиционные токены. */
  key: string;
  separator: ArgvSeparator;
  /** Исходный текст токенов-значений (с кавычками), через пробел; пустой — булев флаг. */
  value: string;
}

export class ArgvSyntaxError extends Error {}

interface Token {
  /** Текст токена в исходной строке, с кавычками и экранированием. */
  raw: string;
  /** Токен после снятия кавычек — то, что получит движок в argv. */
  text: string;
}

/** Токенизация как `shlex.split` в POSIX-режиме: пробелы разделяют, `'…'`
 * без экранирования, `"…"` с `\` перед `"` и `\`, вне кавычек `\` экранирует
 * следующий символ. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;
    const start = i;
    let text = "";
    while (i < source.length && !/\s/.test(source[i])) {
      const ch = source[i];
      if (ch === "'") {
        const end = source.indexOf("'", i + 1);
        if (end < 0) throw new ArgvSyntaxError("незакрытая одинарная кавычка");
        text += source.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        i++;
        let closed = false;
        while (i < source.length) {
          const c = source[i];
          if (c === '"') {
            closed = true;
            i++;
            break;
          }
          if (c === "\\" && (source[i + 1] === '"' || source[i + 1] === "\\")) {
            text += source[i + 1];
            i += 2;
          } else {
            text += c;
            i++;
          }
        }
        if (!closed) throw new ArgvSyntaxError("незакрытая двойная кавычка");
      } else if (ch === "\\") {
        if (i + 1 >= source.length) throw new ArgvSyntaxError("\\ в конце строки");
        text += source[i + 1];
        i += 2;
      } else {
        text += ch;
        i++;
      }
    }
    tokens.push({ raw: source.slice(start, i), text });
  }
  return tokens;
}

/** argv, который получит движок: то же, что `shlex.split`. */
export function argvOf(source: string): string[] {
  return tokenize(source).map((token) => token.text);
}

const NUMBER = /^-(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Токен-ключ: начинается с `-`, не одиночный `-` и не отрицательное число. */
export function isKeyToken(text: string): boolean {
  return text.length > 1 && text.startsWith("-") && !NUMBER.test(text);
}

export function parseArgv(source: string): ArgvRow[] {
  const rows: ArgvRow[] = [];
  let current: ArgvRow | null = null;
  const pushValue = (row: ArgvRow, raw: string) => {
    row.value = row.value === "" ? raw : `${row.value} ${raw}`;
  };
  for (const token of tokenize(source)) {
    if (isKeyToken(token.text)) {
      const eq = token.raw.indexOf("=");
      current =
        eq > 0
          ? { key: token.raw.slice(0, eq), separator: "=", value: token.raw.slice(eq + 1) }
          : { key: token.raw, separator: " ", value: "" };
      rows.push(current);
    } else {
      if (current === null) {
        current = { key: "", separator: " ", value: "" };
        rows.push(current);
      }
      pushValue(current, token.raw);
    }
  }
  return rows;
}

export function serializeRow(row: ArgvRow): string {
  if (row.key === "") return row.value;
  if (row.value === "") return row.key;
  return `${row.key}${row.separator}${row.value}`;
}

export function serializeArgv(rows: ArgvRow[]): string {
  return rows.map(serializeRow).filter((text) => text !== "").join(" ");
}

/** Ошибка строки списка или `null`. Строка с ошибкой не попадает в
 * командную строку, пока её не исправят (иначе она тихо разобралась бы
 * иначе, чем показана). */
export function rowError(row: ArgvRow, index: number): string | null {
  let keyTokens: Token[];
  let valueTokens: Token[];
  try {
    keyTokens = tokenize(row.key);
    valueTokens = tokenize(row.value);
  } catch (err) {
    return (err as Error).message;
  }
  if (row.key !== "") {
    if (keyTokens.length !== 1 || !isKeyToken(keyTokens[0].text)) return "ключ должен начинаться с - и быть одним словом";
    if (row.separator === "=" && keyTokens[0].raw.includes("=")) return "ключ содержит =";
  } else if (index > 0 && row.value !== "") {
    return "позиционный аргумент допустим только в начале — укажите ключ";
  }
  if (valueTokens.some((token) => isKeyToken(token.text))) return "значение начинается с - — вынесите ключ в отдельную строку";
  if (row.separator === "=" && valueTokens.length > 1) return "с = допустимо только одно значение";
  return null;
}

export function valueTokenCount(value: string): number {
  try {
    return tokenize(value).length;
  } catch {
    return 0;
  }
}
