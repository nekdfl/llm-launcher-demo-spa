import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ArgvEditor } from "./ArgvEditor";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <ArgvEditor value={value} onChange={setValue} />;
}

const raw = () => screen.getByTestId("argv-editor-raw") as HTMLTextAreaElement;

describe("ArgvEditor", () => {
  it("разбирает строку в список со счётчиком", () => {
    render(<Harness initial="--max-concurrency 1 --spec dflash2 --kv-dtype=rk4v4 --vision" />);
    expect(screen.getByTestId("argv-editor-count")).toHaveTextContent("4 параметра");
    expect(screen.getByLabelText("Ключ #3")).toHaveValue("--kv-dtype");
    expect(screen.getByLabelText("Разделитель #3")).toHaveTextContent("=");
    expect(screen.getByLabelText("Значение #4")).toHaveValue("");
    expect(screen.getByLabelText("Значение #4")).toHaveAttribute("placeholder", "булев флаг (без значения)");
  });

  it("правка значения сохраняет запись соседей", () => {
    render(<Harness initial={`--kv-dtype=rk4v4 --spec dflash2 --cfg '{"a": 1}'`} />);
    fireEvent.change(screen.getByLabelText("Значение #2"), { target: { value: "eagle" } });
    expect(raw().value).toBe(`--kv-dtype=rk4v4 --spec eagle --cfg '{"a": 1}'`);
  });

  it("переключение разделителя", () => {
    render(<Harness initial="--ctx-size=4096" />);
    fireEvent.click(screen.getByLabelText("Разделитель #1"));
    expect(raw().value).toBe("--ctx-size 4096");
  });

  it("= недоступен для нескольких значений", () => {
    render(<Harness initial="--served-model-name a b" />);
    expect(screen.getByLabelText("Разделитель #1")).toBeDisabled();
  });

  it("удаление и добавление", () => {
    render(<Harness initial="--a 1 --b 2" />);
    fireEvent.click(screen.getByLabelText("Удалить #1"));
    expect(raw().value).toBe("--b 2");
    fireEvent.click(screen.getByText(/Добавить новый параметр/));
    fireEvent.change(screen.getByLabelText("Ключ #2"), { target: { value: "--prefill-chunk" } });
    fireEvent.change(screen.getByLabelText("Значение #2"), { target: { value: "4096" } });
    expect(raw().value).toBe("--b 2 --prefill-chunk 4096");
  });

  it("перестановка перетаскиванием", () => {
    render(<Harness initial="--a 1 --b 2 --c 3" />);
    const handle = screen.getAllByTitle("Перетащить строку")[2];
    fireEvent.mouseDown(handle);
    const dataTransfer = { setData: () => {}, effectAllowed: "" };
    fireEvent.dragStart(screen.getByTestId("argv-editor-row-2"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("argv-editor-row-0"), { dataTransfer });
    expect(raw().value).toBe("--c 3 --a 1 --b 2");
  });

  it("незакрытая кавычка в значении — ошибка строки, строка не меняется", () => {
    render(<Harness initial="--a 1" />);
    fireEvent.change(screen.getByLabelText("Значение #1"), { target: { value: `'{"x": 1}` } });
    expect(screen.getByTestId("argv-editor-row-0-error")).toHaveTextContent("кавычка");
    expect(raw().value).toBe("--a 1");
    expect(screen.getByTestId("argv-editor-status")).toHaveTextContent("не обновлена");
  });

  it("ошибка разбора сырой строки блокирует список", () => {
    render(<Harness initial="--a 1" />);
    fireEvent.change(raw(), { target: { value: "--a '1" } });
    expect(screen.getByTestId("argv-editor-status")).toHaveTextContent("Ошибка разбора");
    expect(screen.getByLabelText("Значение #1")).toBeDisabled();
  });

  it("копировать кладёт сырую строку в буфер", () => {
    let copied: string | null = null;
    document.execCommand = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null;
      return true;
    });
    render(<Harness initial={`--cfg '{"a": 1}'`} />);
    fireEvent.click(screen.getByTestId("argv-editor-copy"));
    expect(copied).toBe(`--cfg '{"a": 1}'`);
  });

  it("очистить", () => {
    render(<Harness initial="--a 1" />);
    fireEvent.click(screen.getByText("Очистить"));
    expect(raw().value).toBe("");
    expect(screen.getByTestId("argv-editor-count")).toHaveTextContent("0 параметров");
  });
});
