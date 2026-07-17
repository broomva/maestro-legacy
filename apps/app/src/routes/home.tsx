// The mission home (design-fidelity slice 1) — the chat-first, two-plane home surface. The prototype's
// canonical home is `MccMaestroLoopV2` in mission mode (ConceptMaestroLoop.jsx): the work plane
// (feed/board/list) with the orchestrator's conversation co-present in `.mcc-chatside`, docked right. The
// impl had split that into two routes — `/` = board only, `/session/$` = chat only — which inverted the
// product thesis ("chat is a projection … the home IS the conversation", CLAUDE.md §What Maestro is) and
// left the primary surface with no composer, no gate queue, no chat.
//
// This restores it with a single composition: the `Board` mission plane takes the flex space and the
// orchestrator chat + gate queue dock in its right context column (Board's `chatSlot`). Selecting a work
// card swaps that column to the run's inspector; the chat stays mounted underneath. The plane⇄dock collapse
// (workspace mode), session tabs, and column resize are later slices — this slice makes the chat, the
// composer, and the gate queue reachable on the home.

import { Board } from "@/components/board/board";
import { OrchestratorDock } from "./session";

export function MissionHome() {
  return <Board chatSlot={<OrchestratorDock />} />;
}
