import { describe, expect, it } from "vitest";
import standCliOptions from "./__fixtures__/standCliOptions.json";
import { ArgvSyntaxError, argvOf, parseArgv, rowError, serializeArgv, serializeRow } from "./argv";

describe("parseArgv — формы ключей движков", () => {
  it.each([
    ["--max-model-len 262144", [{ key: "--max-model-len", separator: " ", value: "262144" }]],
    ["--kv-dtype=rk4v4", [{ key: "--kv-dtype", separator: "=", value: "rk4v4" }]],
    ["-ngl 999 -c 65536", [{ key: "-ngl", separator: " ", value: "999" }, { key: "-c", separator: " ", value: "65536" }]],
    ["-O3", [{ key: "-O3", separator: " ", value: "" }]],
    ["--vision --no-cuda-graph", [{ key: "--vision", separator: " ", value: "" }, { key: "--no-cuda-graph", separator: " ", value: "" }]],
    ["-fa on --disable-auth true", [{ key: "-fa", separator: " ", value: "on" }, { key: "--disable-auth", separator: " ", value: "true" }]],
    ["--served-model-name a b", [{ key: "--served-model-name", separator: " ", value: "a b" }]],
    ["--graft A=/p/a --graft B=/p/b", [{ key: "--graft", separator: " ", value: "A=/p/a" }, { key: "--graft", separator: " ", value: "B=/p/b" }]],
    ["--speculative-config.method mtp", [{ key: "--speculative-config.method", separator: " ", value: "mtp" }]],
    ["--x.k+='a,b'", [{ key: "--x.k+", separator: "=", value: "'a,b'" }]],
    ["--seed -1 --t -0.5", [{ key: "--seed", separator: " ", value: "-1" }, { key: "--t", separator: " ", value: "-0.5" }]],
    [`--spec '{"method":"mtp", "n":4}'`, [{ key: "--spec", separator: " ", value: `'{"method":"mtp", "n":4}'` }]],
    [`--mm "{\\"image\\":1}"`, [{ key: "--mm", separator: " ", value: `"{\\"image\\":1}"` }]],
    ["model.gguf --port 1", [{ key: "", separator: " ", value: "model.gguf" }, { key: "--port", separator: " ", value: "1" }]],
  ])("%s", (source, rows) => {
    expect(parseArgv(source)).toEqual(rows);
  });

  it("незакрытая кавычка — ошибка", () => {
    expect(() => parseArgv(`--a '{"x": 1}`)).toThrow(ArgvSyntaxError);
  });
});

describe("serializeArgv — без нормализации", () => {
  it("правка одного параметра не меняет запись остальных", () => {
    const source = `--kv-dtype=rk4v4 --spec dflash2 --cfg '{"a": 1}' -ngl 999`;
    const rows = parseArgv(source);
    rows[1] = { ...rows[1], value: "eagle" };
    expect(serializeArgv(rows)).toBe(`--kv-dtype=rk4v4 --spec eagle --cfg '{"a": 1}' -ngl 999`);
  });

  it("разделитель переключается", () => {
    expect(serializeRow({ key: "--ctx-size", separator: "=", value: "4096" })).toBe("--ctx-size=4096");
    expect(serializeRow({ key: "--ctx-size", separator: " ", value: "4096" })).toBe("--ctx-size 4096");
  });

  it("пустые строки списка не попадают в командную строку", () => {
    expect(serializeArgv([{ key: "--a", separator: " ", value: "" }, { key: "", separator: " ", value: "" }])).toBe("--a");
  });
});

describe("данные стенда", () => {
  it.each(standCliOptions.map((entry) => [entry.cli.slice(0, 60), entry] as const))("%s", (_, entry) => {
    expect(argvOf(entry.cli)).toEqual(entry.argv);
    const rows = parseArgv(entry.cli);
    expect(argvOf(serializeArgv(rows))).toEqual(entry.argv);
    // Каждая строка в исходной записи присутствует в собранной строке.
    for (const row of rows) expect(entry.cli).toContain(serializeRow(row));
  });
});

describe("rowError", () => {
  it.each([
    [{ key: "ctx", separator: " ", value: "1" }, 1, "ключ"],
    [{ key: "--a", separator: " ", value: "'x" }, 1, "кавычка"],
    [{ key: "--a", separator: " ", value: "--b" }, 1, "значение начинается"],
    [{ key: "--a", separator: "=", value: "x y" }, 1, "одно значение"],
    [{ key: "", separator: " ", value: "pos" }, 2, "позиционный"],
  ] as const)("%o", (row, index, message) => {
    expect(rowError({ ...row }, index)).toContain(message);
  });

  it("корректные строки без ошибки", () => {
    expect(rowError({ key: "--a", separator: " ", value: "" }, 0)).toBeNull();
    expect(rowError({ key: "--seed", separator: " ", value: "-1" }, 3)).toBeNull();
    expect(rowError({ key: "", separator: " ", value: "model" }, 0)).toBeNull();
  });
});
