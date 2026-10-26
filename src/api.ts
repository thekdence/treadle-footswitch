import { invoke } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/pedal. Keep the two in sync.

export type KeyMode = "hold" | "tap";
export type Trigger = "press" | "release";

export type Action =
  | { kind: "none" }
  | { kind: "key"; modifiers: number; key: number; mode: KeyMode }
  | { kind: "other"; raw: number[] };

export interface Slot {
  index: number;
  action: Action;
  trigger: Trigger | null;
}

export interface PedalState {
  vendorId: number;
  productId: number;
  firmware: string;
  slots: Slot[];
}

export const pedalConnected = () => invoke<boolean>("pedal_connected");
export const readPedal = () => invoke<PedalState>("read_pedal");
export const writePedal = (updates: Slot[]) => invoke<PedalState>("write_pedal", { updates });

/** "FS2020U1IR_V5.7" → { model: "FS2020U1IR", version: "5.7" } */
export function parseFirmware(firmware: string) {
  const [model, version] = firmware.split("_V");
  return { model: model || "Foot switch", version: version ?? "" };
}

