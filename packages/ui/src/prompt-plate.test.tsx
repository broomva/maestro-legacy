/// <reference types="bun" />

// PromptPlate suite (design-fidelity slice 2). Structure via renderToStaticMarkup — the runner has no DOM,
// so the interactive behavior (auto-grow, ⌘L focus, model-menu open, Enter/click send) is dogfooded in the
// browser (home-two-plane.pw.ts + the interceptor pass). The invariants pinned here: PromptPlate is the same
// one glass surface as Composer (`.bv-glass-composer`), it carries the canon dispatch rail (model chip +
// attach + dictate + send) and the ⌘L hint, and the default model catalog leads with the latest Claude.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PROMPT_MODELS, PromptPlate } from "./index";

describe("PromptPlate", () => {
  test("is the one glass surface with the dispatch rail (model chip, attach, dictate, send)", () => {
    const html = renderToStaticMarkup(<PromptPlate />);
    expect(html).toContain("bv-glass-composer"); // the same one glass surface as Composer
    expect(html).toContain('aria-label="Send"'); // send verb
    expect(html).toContain('aria-label="Attach"'); // attach affordance
    expect(html).toContain('aria-label="Dictate"'); // mic affordance
    expect(html).toContain("Opus 4.8"); // the model chip shows the active model (first in the catalog)
    expect(html).toContain("⌘L to focus"); // the focus hint
    expect(html).toContain("bg-transparent"); // the textarea is bare inside the capsule
  });

  test('the default placeholder is "Message Maestro" (D-NAME); a custom one overrides', () => {
    expect(renderToStaticMarkup(<PromptPlate />)).toContain('placeholder="Message Maestro"');
    expect(renderToStaticMarkup(<PromptPlate placeholder="Ask anything" />)).toContain(
      'placeholder="Ask anything"',
    );
  });

  test("busy flips the action verb to Stop (Enter is inert; the visible verb is Stop)", () => {
    expect(renderToStaticMarkup(<PromptPlate busy />)).toContain('aria-label="Stop"');
    expect(renderToStaticMarkup(<PromptPlate busy />)).not.toContain('aria-label="Send"');
  });

  test("the model chip reflects the controlled modelId", () => {
    const html = renderToStaticMarkup(
      <PromptPlate modelId="claude-haiku-4-5" onPickModel={() => {}} />,
    );
    expect(html).toContain("Haiku 4.5");
    expect(html).not.toContain("Opus 4.8");
  });

  test("the default catalog leads with the latest Claude (Opus 4.8) and is non-empty", () => {
    expect(PROMPT_MODELS.length).toBeGreaterThan(0);
    expect(PROMPT_MODELS[0]).toEqual({ id: "claude-opus-4-8", label: "Opus 4.8" });
  });
});
