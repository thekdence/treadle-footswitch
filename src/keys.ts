// HID keyboard usage IDs (USB HID Usage Tables, page 0x07), keyed by the
// browser's KeyboardEvent.code so recorded shortcuts map straight to bytes.

export interface KeyDef {
  usage: number;
  code: string;
  label: string;
  group: KeyGroup;
}

export type KeyGroup = "Letters" | "Numbers" | "Function" | "Navigation" | "Editing" | "Symbols" | "Numpad";

const keys: KeyDef[] = [];

function add(group: KeyGroup, usage: number, code: string, label: string) {
  keys.push({ usage, code, label, group });
}

for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(65 + i);
  add("Letters", 0x04 + i, `Key${ch}`, ch);
}
for (let i = 1; i <= 9; i++) add("Numbers", 0x1d + i, `Digit${i}`, String(i));
add("Numbers", 0x27, "Digit0", "0");

for (let i = 1; i <= 12; i++) add("Function", 0x39 + i, `F${i}`, `F${i}`);
for (let i = 13; i <= 24; i++) add("Function", 0x68 + i - 13, `F${i}`, `F${i}`);

add("Editing", 0x28, "Enter", "Enter");
add("Editing", 0x29, "Escape", "Esc");
add("Editing", 0x2a, "Backspace", "Backspace");
add("Editing", 0x2b, "Tab", "Tab");
add("Editing", 0x2c, "Space", "Space");
add("Editing", 0x39, "CapsLock", "Caps Lock");
add("Editing", 0x46, "PrintScreen", "Print Screen");
add("Editing", 0x47, "ScrollLock", "Scroll Lock");
add("Editing", 0x48, "Pause", "Pause");
add("Editing", 0x49, "Insert", "Insert");
add("Editing", 0x4c, "Delete", "Delete");
add("Editing", 0x65, "ContextMenu", "Menu");

add("Navigation", 0x4a, "Home", "Home");
add("Navigation", 0x4b, "PageUp", "Page Up");
add("Navigation", 0x4d, "End", "End");
add("Navigation", 0x4e, "PageDown", "Page Down");
add("Navigation", 0x4f, "ArrowRight", "→");
add("Navigation", 0x50, "ArrowLeft", "←");
add("Navigation", 0x51, "ArrowDown", "↓");
add("Navigation", 0x52, "ArrowUp", "↑");

add("Symbols", 0x2d, "Minus", "-");
add("Symbols", 0x2e, "Equal", "=");
add("Symbols", 0x2f, "BracketLeft", "[");
add("Symbols", 0x30, "BracketRight", "]");
add("Symbols", 0x31, "Backslash", "\\");
add("Symbols", 0x33, "Semicolon", ";");
add("Symbols", 0x34, "Quote", "'");
add("Symbols", 0x35, "Backquote", "`");
add("Symbols", 0x36, "Comma", ",");
add("Symbols", 0x37, "Period", ".");
add("Symbols", 0x38, "Slash", "/");
add("Symbols", 0x64, "IntlBackslash", "Intl \\");

add("Numpad", 0x53, "NumLock", "Num Lock");
add("Numpad", 0x54, "NumpadDivide", "Num /");
add("Numpad", 0x55, "NumpadMultiply", "Num *");
add("Numpad", 0x56, "NumpadSubtract", "Num -");
add("Numpad", 0x57, "NumpadAdd", "Num +");
add("Numpad", 0x58, "NumpadEnter", "Num Enter");
for (let i = 1; i <= 9; i++) add("Numpad", 0x58 + i, `Numpad${i}`, `Num ${i}`);
add("Numpad", 0x62, "Numpad0", "Num 0");
add("Numpad", 0x63, "NumpadDecimal", "Num .");

export const KEYS = keys;
export const KEY_GROUPS: KeyGroup[] = ["Function", "Letters", "Numbers", "Editing", "Navigation", "Symbols", "Numpad"];

const byCode = new Map(keys.map((k) => [k.code, k]));
const byUsage = new Map(keys.map((k) => [k.usage, k]));

export const keyForCode = (code: string) => byCode.get(code);

export function keyLabel(usage: number): string {
  return byUsage.get(usage)?.label ?? `Key 0x${usage.toString(16).padStart(2, "0")}`;
}

// HID modifier bitmask.
export const MOD = {
  LCtrl: 0x01,
  LShift: 0x02,
  LAlt: 0x04,
  LMeta: 0x08,
  RCtrl: 0x10,
  RShift: 0x20,
  RAlt: 0x40,
  RMeta: 0x80,
} as const;

const modifierCodes: Record<string, number> = {
  ControlLeft: MOD.LCtrl,
  ShiftLeft: MOD.LShift,
  AltLeft: MOD.LAlt,
  MetaLeft: MOD.LMeta,
  ControlRight: MOD.RCtrl,
  ShiftRight: MOD.RShift,
  AltRight: MOD.RAlt,
  MetaRight: MOD.RMeta,
};

export const modifierBit = (code: string): number | undefined => modifierCodes[code];

/** Modifiers held during a keyboard event, as a left-hand HID bitmask. */
export function modifiersOf(e: KeyboardEvent): number {
  return (
    (e.ctrlKey ? MOD.LCtrl : 0) |
    (e.shiftKey ? MOD.LShift : 0) |
    (e.altKey ? MOD.LAlt : 0) |
    (e.metaKey ? MOD.LMeta : 0)
  );
}

/** Fold right-hand modifier bits onto the left so L/R compare equal. */
export const foldSides = (mods: number) => (mods | (mods >> 4)) & 0x0f;

const isMac = navigator.platform.toLowerCase().includes("mac");

export function modifierLabels(mods: number): string[] {
  const names: [number, string][] = isMac
    ? [[MOD.LCtrl, "⌃ Control"], [MOD.LAlt, "⌥ Option"], [MOD.LShift, "⇧ Shift"], [MOD.LMeta, "⌘ Cmd"]]
    : [[MOD.LCtrl, "Ctrl"], [MOD.LShift, "Shift"], [MOD.LAlt, "Alt"], [MOD.LMeta, "Win"]];
  return names.flatMap(([bit, name]) => {
    const left = mods & bit;
    const right = mods & (bit << 4);
    if (left && right) return [`L${name}`, `R${name}`];
    if (right) return [`Right ${name}`];
    if (left) return [name];
    return [];
  });
}
