import { beforeEach, describe, expect, it } from "vitest";

import { applicationI18n } from "../../localization/i18n";
import { displayPortType, portDescriptionKey } from "./port-presentation";

describe("port presentation", () => {
  beforeEach(async () => {
    await applicationI18n.changeLanguage("zh-CN");
  });

  it("localizes technical types and removes duplicate result wording", () => {
    expect(displayPortType(applicationI18n.t, "ocrResult", "full")).toBe(
      "识别结果",
    );
    expect(
      displayPortType(applicationI18n.t, "collection<optional<rect>>", "full"),
    ).toBe("可选区域列表");
  });

  it("does not attach recognition help to arithmetic result ports", () => {
    expect(
      portDescriptionKey("node.core.math.arithmetic.port.result", "result"),
    ).toBeUndefined();
    expect(portDescriptionKey("node.text.readText.port.result", "result")).toBe(
      "graph.port.description.recognitionResult",
    );
  });
});
