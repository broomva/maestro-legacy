import { expect, test } from "@playwright/test";

// Two-plane mission home (design-fidelity slice 1), in a real browser. Proves `/` is the chat-first home
// (CLAUDE.md §What Maestro is; the prototype's mission mode, ConceptMaestroLoop `MccMaestroLoopV2` — the
// work plane with the orchestrator conversation co-present in `.mcc-chatside`). Before this slice the home
// was board-only and the chat/composer/gate-queue lived on a separate `/session/$` route.
//
// Asserts: (1) the work plane AND the orchestrator chat dock (composer) render SIDE BY SIDE on `/`; and
// (2) selecting a work card swaps the right context column to that run's inspector while the chat stays
// MOUNTED underneath (hidden, not unmounted) — a card click never discards the conversation.
//
// HERMETIC: data mocked at the network layer (page.route on /api/tree + /api/stream), no real runtime —
// the live-SSE seam is proven by p1-exit/p3-exit; this exercises the real MissionHome / Board / dock tree.
// The dock is `hidden lg:flex`, so the test runs at a desktop width where it is shown.

test.use({ viewport: { width: 1440, height: 900 } });

const T = 1_700_000_000_000;

const node = (o: {
  id: string;
  path: string;
  state: string;
  title: string;
  updatedAt?: number;
}) => ({
  id: o.id,
  path: o.path,
  parentId: null,
  kind: "task",
  state: o.state,
  owner: null,
  gate: "human",
  budgetJson: null,
  doneJson: null,
  title: o.title,
  createdAt: T,
  updatedAt: o.updatedAt ?? T,
});

const NODES = [
  node({
    id: "review1",
    path: "feat",
    state: "review",
    title: "Ship the feature",
    updatedAt: T + 2,
  }),
  node({
    id: "done1",
    path: "feat2",
    state: "done",
    title: "Ship the second feature",
    updatedAt: T + 1,
  }),
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/tree*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ nodes: NODES }) }),
  );
  // An inert stream (the dock's useBvChat is side-effect-free on mount; nothing dispatches here).
  await page.route("**/api/stream*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: "retry: 3600000\n\n",
    }),
  );
});

test("the home renders the work plane AND the orchestrator chat dock side by side", async ({
  page,
}) => {
  await page.goto("/");
  // The work plane (rung 1).
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("plane-feed")).toBeVisible();
  // The orchestrator chat docked right (rung 2/3) — chat is the home, not a separate route.
  await expect(page.getByTestId("orchestrator-dock")).toBeVisible();
  // The composer is on the primary surface (the prototype's PromptPlate foot).
  await expect(page.getByPlaceholder("Message Maestro")).toBeVisible();
});

test("selecting a card swaps the dock to the inspector; the chat stays mounted underneath", async ({
  page,
}) => {
  await page.goto("/");
  // Default: no card selected → the dock shows the chat (composer), no inspector.
  await expect(page.getByPlaceholder("Message Maestro")).toBeVisible();
  await expect(page.getByTestId("inspector-panel")).toHaveCount(0);

  // Select the review card → the context column swaps to its inspector.
  await page.getByTestId("board-group-review").getByText("Ship the feature").click();
  await expect(page.getByTestId("inspector-panel")).toBeVisible();

  // The chat is HIDDEN, not unmounted — the composer stays in the DOM (count 1) so the conversation and
  // any in-flight streaming turn survive a card click; it is just not shown while inspecting.
  await expect(page.getByPlaceholder("Message Maestro")).toBeHidden();
  await expect(page.getByPlaceholder("Message Maestro")).toHaveCount(1);

  // Close the inspector → the chat returns (same instance).
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
  await expect(page.getByPlaceholder("Message Maestro")).toBeVisible();
});
