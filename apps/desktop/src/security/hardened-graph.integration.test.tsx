import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { App } from "../app/App";
import { useDocumentStore } from "../graph/store/document-store";
import { closeProjectDocument } from "../graph/store/project-lifecycle";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../test/project-transport-double";
import { hardenObjectPrototype } from "./prototype-hardening";

it("renders a node inserted after application prototype hardening", async () => {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  await applicationI18n.changeLanguage("zh-CN");
  closeProjectDocument();
  installInMemoryProjectService();

  hardenObjectPrototype();
  render(<App />);
  await createProjectFromEmptyState();

  await userEvent.click(screen.getByRole("button", { name: "打开节点库" }));
  const palette = screen.getByRole("complementary", { name: "节点库" });
  await userEvent.click(within(palette).getByText("开始"));

  expect(
    await within(screen.getByLabelText("节点图")).findByText("开始"),
  ).toBeInTheDocument();
  expect(
    useDocumentStore.getState().history?.document.graphs[0]?.nodes,
  ).toHaveLength(1);
});
