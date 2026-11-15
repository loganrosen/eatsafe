import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const groceryRows = JSON.parse(
  readFileSync(
    new URL("../fixtures/grocery-search.json", import.meta.url),
    "utf8",
  ),
);
const restaurantRows = JSON.parse(
  readFileSync(
    new URL("../fixtures/restaurant-search.json", import.meta.url),
    "utf8",
  ),
);

async function mockOpenData(page: Page) {
  await page.route("https://data.cityofnewyork.us/**", (route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get("$select");
    return route.fulfill({
      contentType: "application/json",
      json: select ? [] : restaurantRows,
    });
  });
  await page.route("https://data.ny.gov/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: groceryRows,
    }),
  );
}

test("production app starts without runtime errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack ?? error.message);
  });

  await mockOpenData(page);

  await page.goto("/");

  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "SEARCH" })).toBeVisible();
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

test("restores restaurant search state from the URL", async ({ page }) => {
  await mockOpenData(page);
  await page.goto("/?name=Joe");

  await expect(page.getByRole("link", { name: /JOE'S PIZZA/ })).toBeVisible();
  await expect(page.getByText("1 restaurant")).toBeVisible();
});

test("searches the grocery dataset and opens a detail page", async ({
  page,
}) => {
  await mockOpenData(page);
  await page.goto("/?mode=grocery&name=Key");

  await page.getByRole("link", { name: /KEY FOOD/ }).click();
  await expect(page).toHaveURL(/\/store\//);
  await expect(page.getByRole("heading", { name: "KEY FOOD" })).toBeVisible();
});

test("shows validation errors without calling the upstream search", async ({
  page,
}) => {
  let searchRequests = 0;
  await page.route("https://data.cityofnewyork.us/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get("$select")) searchRequests++;
    return route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /MORE FILTERS/ }).click();
  await page.getByLabel("Zip Code").fill("123");
  await page.getByRole("button", { name: "SEARCH" }).click();

  await expect(
    page.getByText("Zip code must contain exactly 5 digits."),
  ).toBeVisible();
  expect(searchRequests).toBe(0);
});

test("keeps the newest result when searches finish out of order", async ({
  page,
}) => {
  await page.route("https://data.cityofnewyork.us/**", async (route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get("$select");
    const where = url.searchParams.get("$where") ?? "";
    if (select) {
      await route.fulfill({ contentType: "application/json", json: [] });
      return;
    }
    if (where.includes("FIRST")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        contentType: "application/json",
        json: [{ ...restaurantRows[0], dba: "FIRST RESULT" }],
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: [{ ...restaurantRows[0], dba: "SECOND RESULT" }],
    });
  });

  await page.goto("/");
  const name = page.getByLabel("Restaurant Name");
  await name.fill("First");
  await page.getByRole("button", { name: "SEARCH" }).click();
  await name.fill("Second");
  await name.press("Enter");

  await expect(page.getByRole("link", { name: /SECOND RESULT/ })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.getByRole("link", { name: /FIRST RESULT/ })).toHaveCount(0);
});

test("restores recent closures including reopened restaurants", async ({
  page,
}) => {
  const closed = {
    ...restaurantRows[0],
    camis: "50000001",
    dba: "CLOSED PLACE",
    inspection_date: "2026-09-01T00:00:00.000",
    action: "Establishment Closed by DOHMH.",
  };
  const reopenedClosure = {
    ...restaurantRows[0],
    camis: "50000002",
    dba: "REOPENED PLACE",
    inspection_date: "2026-08-20T00:00:00.000",
    action: "Establishment Closed by DOHMH.",
  };
  const reopened = {
    ...reopenedClosure,
    inspection_date: "2026-08-22T00:00:00.000",
    action: "Establishment re-opened by DOHMH.",
  };

  await page.route("https://data.cityofnewyork.us/**", (route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get("$select");
    const where = url.searchParams.get("$where") ?? "";
    const json = select
      ? []
      : where.includes("upper(action)")
        ? [closed, reopenedClosure]
        : [closed, reopenedClosure, reopened];
    return route.fulfill({ contentType: "application/json", json });
  });

  await page.goto("/?view=recent&feed=closures&include=reopened");

  await expect(page.getByRole("link", { name: /CLOSED PLACE/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /REOPENED PLACE/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/including places that have since/),
  ).toBeVisible();
});

test("shows a useful upstream service error", async ({ page }) => {
  await page.route("https://data.cityofnewyork.us/**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: url.searchParams.get("$select") ? 200 : 500,
      contentType: "application/json",
      json: [],
    });
  });
  await page.goto("/");
  await page.getByLabel("Restaurant Name").fill("Joe");
  await page.getByRole("button", { name: "SEARCH" }).click();

  await expect(
    page.getByText("The inspection data service returned an error (HTTP 500)."),
  ).toBeVisible();
});
