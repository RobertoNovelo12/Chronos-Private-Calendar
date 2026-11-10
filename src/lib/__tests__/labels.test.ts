import { describe, expect, it } from "vitest";
import { nextLabelColor } from "@/stores/labelStore";
import type { Label } from "@/types/domain";

const label = (color: string): Label => ({ id: color, name: color, color, createdAt: 0, updatedAt: 0 });

describe("etiquetas", () => {
  it("elige el primer color libre de la paleta", () => {
    expect(nextLabelColor([], ["#a", "#b"])).toBe("#a");
    expect(nextLabelColor([label("#a")], ["#a", "#b"])).toBe("#b");
  });

  it("si todos están usados, rota por la paleta", () => {
    expect(nextLabelColor([label("#a"), label("#b"), label("#a")], ["#a", "#b"])).toBe("#b");
  });
});
