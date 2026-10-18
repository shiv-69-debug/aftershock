import { expect, test } from "@playwright/test";

test("private workspace imports data, exposes paths, persists conversation and enforces membership", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.RUN_EXPERIMENTAL_TESTS !== "1",
    "Experimental workspace UI is outside the verified submission scope.",
  );
  const username = `ui_${Date.now()}`;
  const password = "Synthetic-test-password-2026!";
  await page.goto("/workspaces");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New workspace name" })
    .fill("UI graph workspace");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Use training example" }).click();
  await expect(
    page.getByRole("heading", {
      name: "AFTERSHOCK synthetic training topology",
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Investigation service" })
    .selectOption({ label: "checkout-api" });
  await page.getByRole("button", { name: "Compare 1 vs 3 hops" }).click();
  await expect(page.locator(".depth-comparison>div>strong").nth(0)).toHaveText(
    "1",
  );
  await expect(page.locator(".depth-comparison>div>strong").nth(1)).toHaveText(
    "4",
  );
  await page
    .getByLabel("From", { exact: true })
    .selectOption({ label: "Orbit Commerce" });
  await page
    .getByLabel("To", { exact: true })
    .selectOption({ label: "checkout-api" });
  await page
    .getByRole("button", { name: "Find shortest path", exact: true })
    .click();
  await expect(page.locator(".path-row strong")).toHaveText(
    "Orbit Commerce → storefront → order-service → checkout-api",
  );
  await expect(page.locator(".product-graph .edge-active")).toHaveCount(3);
  const workspaceId = new URL(page.url()).searchParams.get("workspace")!;

  await page
    .getByRole("button", { name: "Agent sessions", exact: true })
    .click();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByLabel("Tool selection", { exact: true })
    .selectOption("trace_blast_radius");
  await page
    .getByRole("textbox", { name: "Workspace question" })
    .fill("Trace the checkout dependencies from the graph.");
  await page
    .getByRole("button", { name: "Run workspace agent", exact: true })
    .click();
  await expect(page.locator(".session-message.assistant")).toContainText(
    "Orbit Commerce",
  );
  await expect(
    page.getByText("Actual MCP tool result", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Agent sessions", exact: true })
    .click();
  await page
    .locator(".session-list>button:not(.secondary-button)")
    .first()
    .click();
  await expect(page.locator(".session-message.user")).toContainText(
    "Trace the checkout dependencies",
  );
  await expect(page.locator(".session-message.assistant")).toContainText(
    "Orbit Commerce",
  );
  const dashboard = await page.request
    .get(`/api/workspaces/${workspaceId}`)
    .then((response) => response.json());
  const conversationId = dashboard.conversations[0].id;

  const other = await browser.newContext();
  try {
    const otherName = `other_${Date.now()}`;
    const signup = await other.request.post("/api/auth", {
      data: { action: "register", username: otherName, password },
    });
    expect(signup.ok()).toBe(true);
    expect(
      (await other.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(404);
    await page.request.post(`/api/workspaces/${workspaceId}`, {
      data: { op: "invite", username: otherName, role: "reader" },
    });
    expect(
      (await other.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(200);
    expect(
      (
        await other.request.get(
          `/api/workspaces/${workspaceId}?view=conversation&conversation=${conversationId}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post(`/api/workspaces/${workspaceId}`, {
          data: { op: "training" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`/api/workspaces/${workspaceId}`, {
          headers: { Origin: "https://untrusted.example" },
          data: { op: "token" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await other.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
