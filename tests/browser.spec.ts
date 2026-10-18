import { expect, test } from "@playwright/test";

test("preview exposes evidence, queries, and mobile navigation without fabricating an investigation", async ({
  page,
}) => {
  await page.route("**/api/graph", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ connected: false }),
    }),
  );
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "AFTERSHOCK" })).toBeVisible();
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await expect(
    page.getByText("You’re exploring a visual preview."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Investigate incident" }),
  ).toBeDisabled();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "See every step. Verify the result." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "checkout-api, Service. Inspect evidence" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Source evidence" }),
  ).toBeVisible();
  await expect(
    page.getByText("catalog/services/checkout-api", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page.getByRole("button", { name: "Graph queries" }).click();
  await expect(
    page.getByRole("heading", { name: "Trace the blast radius" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Command center" }).click();
  await expect(
    page.getByRole("heading", { name: "Blast radius", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "New investigation" }).click();
  await expect(
    page.getByRole("region", { name: "Enter the incident workspace" }),
  ).toBeVisible();
});

test("live graph revises recommendations and recalls saved resolution", async ({
  page,
  request,
}) => {
  test.skip(
    !(await request.get("/api/graph")).ok(),
    "FalkorDB must be running",
  );
  await request.post("/api/scenario", { data: { action: "seed" } });
  await request.post("/api/scenario", {
    data: { action: "constraint", active: false },
  });
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await page.getByRole("button", { name: "Investigate incident" }).click();
  await expect(
    page.getByRole("heading", { name: "Sandbox: roll back checkout v2.4.7." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inject migration" }).click();
  await page.getByRole("button", { name: "Re-investigate" }).click();
  await expect(
    page.getByRole("heading", { name: "Sandbox: disable fast_payments." }),
  ).toBeVisible();
  await expect(
    page.getByText("RECOMMENDATION REVISED", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record simulation note" }).click();
  await expect(
    page.getByRole("button", { name: "Saved to memory" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await page.getByRole("button", { name: "Incident memory" }).click();
  await expect(
    page.getByRole("heading", { name: /^Simulation note ·/ }).first(),
  ).toBeVisible();
});

test("entry percentage completes before the workspace can be opened", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-18T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-18T00:00:01Z"));
  await page.goto("/workspace");
  await expect(
    page.getByRole("progressbar", { name: "Interface preparation" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    page.getByRole("button", { name: /Preparing interface/ }),
  ).toBeDisabled();
  await page.clock.fastForward(2500);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await page.clock.fastForward(700);
  await expect(
    page.getByRole("heading", { name: "Blast radius", exact: true }),
  ).toBeVisible();
});

test("reduced-motion entry supports keyboard navigation without animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace");
  const enter = page.getByRole("button", { name: "Enter investigation" });
  await expect(enter).toBeEnabled();
  await enter.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Follow the failure." }),
  ).toBeFocused();
});

test("the interface exposes agent controls rather than a chat endpoint", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Enter investigation" }).click();
  await expect(
    page.getByRole("heading", { name: "Read context → decide → record" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Load handoff → recheck → act" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const removed = await request.post("/api/chat", {
    data: { question: "hello" },
  });
  expect([404, 405]).toContain(removed.status());
});
