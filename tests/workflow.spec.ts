import { expect, test } from "@playwright/test";

test("a persisted handoff produces a verifiable sandbox HTTP behavior change", async ({
  page,
  request,
}) => {
  test.skip(!(await request.get("/api/graph")).ok(), "FalkorDB is required");
  await request.post("/api/scenario", { data: { action: "seed" } });
  await request.post("/api/scenario", {
    data: { action: "constraint", active: true },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await page.getByRole("button", { name: "Investigate incident" }).click();
  await expect(
    page.getByRole("heading", { name: "Sandbox: disable fast_payments." }),
  ).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workflow") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Hand off to responder" }).click();
  const { handoff } = await (await created).json();
  const probeUrl = `/api/sandbox/${handoff.sandboxId}`;
  const before = await request.get(probeUrl);
  expect(before.status()).toBe(504);
  const item = page
    .locator(".workflow-item")
    .filter({ hasText: `Handoff ${handoff.id.slice(0, 8)}` });
  await expect(item.getByText("PENDING — NOT EXECUTED")).toBeVisible();
  await item.getByRole("button", { name: "Run sandbox action" }).click();
  await expect(
    item.getByText("SANDBOX VERIFIED", { exact: true }),
  ).toBeVisible();
  const after = await request.get(probeUrl);
  expect(after.status()).toBe(200);
  expect((await after.json()).state.fastPayments).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await expect(
    item.getByText("SANDBOX VERIFIED", { exact: true }),
  ).toBeVisible();
  await item.getByText("Inspect provenance", { exact: true }).click();
  await expect(item).toContainText(handoff.runId);
  await expect(item).toContainText("checkout-runbook");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
