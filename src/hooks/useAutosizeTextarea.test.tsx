import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAutosizeTextarea } from "./useAutosizeTextarea";

function Area({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(ref, value);
  return <textarea ref={ref} value={value} readOnly data-testid="area" />;
}

describe("useAutosizeTextarea", () => {
  it("высота = scrollHeight и пересчитывается при смене текста", () => {
    let scrollHeight = 120;
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);
    const { getByTestId, rerender } = render(<Area value="длинный текст" />);
    expect(getByTestId("area").style.height).toBe("120px");

    scrollHeight = 40;
    rerender(<Area value="коротко" />);
    expect(getByTestId("area").style.height).toBe("40px");
    spy.mockRestore();
  });
});
