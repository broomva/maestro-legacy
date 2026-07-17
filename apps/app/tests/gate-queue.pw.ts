import { expect, test } from "@playwright/test";

// Gate queue (BRO-1888 FID-3) interactive — the grace-window state machine in a real browser. Driven
// via /kitchen-sink (the component gallery) with seeded items + a capturing onIntent, so the proof is
// decoupled from the store + SSE gate-row seeding (a live `gateId` needs `gate.opened` stream frames).
// The live docking is proven by the orchestrator session mount; this exercises the component's own
// logic: look-before-verb, Approve reversible for a beat, blocked redispatch, and "no percentages".

test.beforeEach(async ({ page }) => {
  await page.goto("/kitchen-sink");
  await expect(page.getByTestId("gate-queue")).toBeVisible();
});

test("a review card expands to the look + verbs; the empty queue is all-clear; no percentages", async ({
  page,
}) => {
  const queue = page.getByTestId("gate-queue");
  // The seed has a review + a blocked leaf; a second (empty) instance renders the all-clear line.
  await expect(queue.locator('[data-testid="gate-card"]')).toHaveCount(2);
  await expect(page.getByTestId("gate-allclear")).toBeVisible();

  // "Needs you" (review) dot is accent-blue, never red (the tone → --bv-blue-accent join).
  const reviewCard = queue.locator('[data-state="review"]');
  await expect(reviewCard.locator(".mc-chip-dot").first()).toHaveAttribute(
    "style",
    /bv-blue-accent/,
  );

  // The PRIMARY gate is auto-expanded (the prototype opens index 0) — the look + verbs show without a
  // click, so the human can act at a glance. Approve stays reversible for its grace window.
  await expect(reviewCard.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(reviewCard.getByRole("button", { name: "Send back", exact: true })).toBeVisible();
  // The look sits on the card so the approve verb is never blind (the run receipt shows).
  await expect(reviewCard).toContainText("run/7c2f1a");

  // Receipts, never a progress percentage (CLAUDE.md §Work states).
  await expect(queue).not.toContainText("%");
});

test("Approve is reversible for a beat: Undo cancels the send; letting it lapse dispatches the intent", async ({
  page,
}) => {
  const queue = page.getByTestId("gate-queue");
  const reviewCard = queue.locator('[data-state="review"]');
  // The primary card is auto-expanded — Approve is available without a click.

  // Approve → the grace/undo chip appears, and NOTHING is dispatched yet (the intent waits out the window).
  await reviewCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(reviewCard.getByTestId("gate-done")).toBeVisible();
  await expect(reviewCard.getByRole("button", { name: /Undo/ })).toBeVisible();
  await expect(page.getByTestId("gate-dispatched")).toHaveCount(0);

  // Undo → back to the verbs, still nothing dispatched.
  await reviewCard.getByRole("button", { name: /Undo/ }).click();
  await expect(reviewCard.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByTestId("gate-dispatched")).toHaveCount(0);

  // Approve again, let the grace window lapse → the approve intent dispatches, keyed on the gateId.
  await reviewCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByTestId("gate-dispatched")).toContainText("approve:gate-1", {
    timeout: 8000,
  });
});

test("unmounting mid-grace COMMITS the chosen verdict (not Undo) — a session switch never silently drops an approve", async ({
  page,
}) => {
  const queue = page.getByTestId("gate-queue");
  const reviewCard = queue.locator('[data-state="review"]');
  // The primary card is auto-expanded — Approve is available without a click.

  // Approve → grace window open, nothing dispatched yet.
  await reviewCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(reviewCard.getByRole("button", { name: /Undo/ })).toBeVisible();
  await expect(page.getByTestId("gate-dispatched")).toHaveCount(0);

  // Unmount the queue WHILE the verdict is still in its grace window (the live analogue is switching
  // sessions). gate.ts §PendingVerdict: leaving is not Undo, so the approve must still be POSTed.
  await page.getByTestId("gate-mount-toggle").click();
  await expect(queue).toHaveCount(0);
  await expect(page.getByTestId("gate-dispatched")).toContainText("approve:gate-1", {
    timeout: 3000,
  });
});

test("closing a card mid-send-back discards the draft — reopening shows the default verbs, not a stale note", async ({
  page,
}) => {
  const queue = page.getByTestId("gate-queue");
  const reviewCard = queue.locator('[data-state="review"]');

  // The primary card is auto-expanded → Send back → type a draft, then close the card WITHOUT sending or
  // cancelling.
  await reviewCard.getByRole("button", { name: "Send back", exact: true }).click();
  await reviewCard.locator(".mcc-gateq-note-input").fill("half-typed feedback");
  await reviewCard.locator(".mcc-gateq-row").click();
  await expect(reviewCard.locator(".mcc-gateq-note-input")).toHaveCount(0);

  // Reopen → the default verbs are back, no stale note editor.
  await reviewCard.locator(".mcc-gateq-row").click();
  await expect(reviewCard.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(reviewCard.locator(".mcc-gateq-note-input")).toHaveCount(0);
});

test("Send back collects a note (a revise carries feedback); a blocked card redispatches immediately", async ({
  page,
}) => {
  const queue = page.getByTestId("gate-queue");

  // Send back reveals a note (revise{gateId, feedback}); an empty note cannot send.
  const reviewCard = queue.locator('[data-state="review"]');
  // The primary card is auto-expanded — Send back is available without a click.
  await reviewCard.getByRole("button", { name: "Send back", exact: true }).click();
  const note = reviewCard.locator(".mcc-gateq-note-input");
  await expect(note).toBeVisible();
  await expect(reviewCard.getByRole("button", { name: "Send back", exact: true })).toBeDisabled();
  await note.fill("rework the migration path");
  await reviewCard.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(page.getByTestId("gate-dispatched")).toContainText("revise:gate-1", {
    timeout: 8000,
  });

  // A blocked (Stuck) card is redispatchable — no gate verdict, keyed on the node, fires immediately.
  const blockedCard = queue.locator('[data-state="blocked"]');
  await blockedCard.locator(".mcc-gateq-row").click();
  await blockedCard.getByRole("button", { name: "Redispatch", exact: true }).click();
  await expect(page.getByTestId("gate-dispatched")).toContainText("dispatch:g-token", {
    timeout: 3000,
  });
});
