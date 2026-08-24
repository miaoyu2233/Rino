import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductIcon } from "./ProductIcon";
import { productIcons } from "./product-icons";

describe("ProductIcon", () => {
  it("renders labeled icons as accessible images", () => {
    render(<ProductIcon icon="node.ocr" label="OCR" size="large" />);

    const icon = screen.getByRole("img", { name: "OCR" });
    expect(icon).toHaveClass("product-icon", "product-icon--large");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
  });

  it("keeps decorative icons out of the accessibility tree", () => {
    const { container } = render(<ProductIcon icon="runtime.idle" />);
    const icon = container.querySelector("svg");

    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("defines every required icon family with static components", () => {
    const keys = Object.keys(productIcons);

    expect(keys.some((key) => key.startsWith("action."))).toBe(true);
    expect(keys.some((key) => key.startsWith("run."))).toBe(true);
    expect(keys.some((key) => key.startsWith("category."))).toBe(true);
    expect(keys.some((key) => key.startsWith("node."))).toBe(true);
    expect(keys.some((key) => key.startsWith("recognition."))).toBe(true);
    expect(keys.some((key) => key.startsWith("runtime."))).toBe(true);
    expect(
      Object.values(productIcons).every((icon) => typeof icon === "object"),
    ).toBe(true);
  });
});
