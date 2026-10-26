// Fake pedal for working on the UI in a plain browser (`npm run dev`).
// Only loaded in dev builds when the Tauri runtime is missing.
//   ?pedal=none   no pedal plugged in
//   ?pedal=other  pedal 3 holds a mouse action Treadle can't edit
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { PedalState, Slot } from "./api";

const mode = new URLSearchParams(location.search).get("pedal");

let state: PedalState = {
  vendorId: 0x3553,
  productId: 0xb001,
  firmware: "FS2020U1IR_V5.7",
  slots: [0x6a, 0x6b, 0x6c].map((key, i) => ({
    index: i + 1,
    action: { kind: "key", modifiers: 0, key, mode: "hold" },
    trigger: "press",
  })),
};
if (mode === "other") state.slots[2].action = { kind: "other", raw: [8, 2, 0, 0, 1, 0, 0, 0] };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

mockWindows("main");
mockIPC(async (cmd, args) => {
  switch (cmd) {
    case "pedal_connected":
      return mode !== "none";
    case "read_pedal":
      await delay(300);
      return structuredClone(state);
    case "write_pedal": {
      await delay(600);
      const updates = (args as { updates: Slot[] }).updates;
      state = { ...state, slots: state.slots.map((s) => updates.find((u) => u.index === s.index) ?? s) };
      return structuredClone(state);
    }
    default:
      return null;
  }
});
