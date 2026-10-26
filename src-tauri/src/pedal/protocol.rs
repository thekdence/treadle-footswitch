//! Wire format for PCsensor foot switches (VID 0x3553 and friends).
//!
//! The configuration channel is a vendor HID interface with 8-byte input and
//! output reports and no report IDs. Every command is one 8-byte report whose
//! first byte is `0x01` and second byte is the opcode. Mappings live in the
//! pedal's own flash, so once written the pedal works as a plain USB keyboard
//! on any computer.
//!
//! See `docs/PROTOCOL.md` for the full description.

use serde::{Deserialize, Serialize};

pub type Report = [u8; 8];

/// Begin a programming session. Sent once before any slot writes.
pub const BEGIN_WRITE: Report = [0x01, 0x80, 0x80, 0x01, 0, 0, 0, 0];

/// Ask for the firmware identification string (e.g. `FS2020U1IR_V5.7`).
/// The pedal answers with up to four 8-byte reports of NUL-padded ASCII.
pub const READ_VERSION: Report = [0x01, 0x83, 0x08, 0, 0, 0, 0, 0];

/// Ask for the press/release trigger of every slot.
pub const READ_TRIGGERS: Report = [0x01, 0x86, 0, 0, 0, 0, 0, 0];

/// Slot payload type byte. Bit 7 set means "tap" (send the key once on
/// trigger); clear means "hold" (key stays down while the pedal is down).
const TYPE_NONE: u8 = 0x00;
const TYPE_KEY: u8 = 0x01;
const TAP_BIT: u8 = 0x80;

pub fn read_slot(slot: u8) -> Report {
    [0x01, 0x82, 0x08, slot, 0, 0, 0, 0]
}

pub fn write_slot_header(slot: u8) -> Report {
    [0x01, 0x81, 0x08, slot, 0, 0, 0, 0]
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KeyMode {
    /// Key is held down for as long as the pedal is.
    Hold,
    /// Key is pressed and released once.
    Tap,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Trigger {
    Press,
    Release,
}

/// What a slot does. Only keyboard actions are editable for now; anything
/// else the vendor app can program (mouse, text, media, macros) is kept as
/// raw bytes so it can be shown and left untouched.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    None,
    /// `modifiers` is the standard HID modifier bitmask, `key` a HID keyboard
    /// usage ID (0 for a modifier-only shortcut).
    #[serde(rename_all = "camelCase")]
    Key { modifiers: u8, key: u8, mode: KeyMode },
    Other { raw: Vec<u8> },
}

impl Action {
    pub fn is_editable(&self) -> bool {
        !matches!(self, Action::Other { .. })
    }
}

/// The single data report that follows a slot header.
pub fn encode_action(action: &Action) -> Option<Report> {
    match *action {
        // Matches what the vendor app writes for an empty slot.
        Action::None => Some([0x08, TYPE_KEY, 0, 0, 0, 0, 0, 0]),
        Action::Key { modifiers, key, mode } => {
            let ty = match mode {
                KeyMode::Hold => TYPE_KEY,
                KeyMode::Tap => TYPE_KEY | TAP_BIT,
            };
            Some([0x08, ty, modifiers, key, 0, 0, 0, 0])
        }
        Action::Other { .. } => None,
    }
}

/// Decode the reports the pedal returns for `read_slot`.
pub fn decode_action(reports: &[Report]) -> Action {
    let Some(first) = reports.first() else {
        return Action::None;
    };
    match first[1] {
        TYPE_NONE => Action::None,
        ty if ty & !TAP_BIT == TYPE_KEY => {
            let (modifiers, key) = (first[2], first[3]);
            if modifiers == 0 && key == 0 {
                return Action::None;
            }
            let mode = if ty & TAP_BIT != 0 { KeyMode::Tap } else { KeyMode::Hold };
            Action::Key { modifiers, key, mode }
        }
        _ => Action::Other {
            raw: reports.iter().flatten().copied().collect(),
        },
    }
}

/// Header + payload for writing the trigger of every slot at once.
/// The length byte counts itself, so it is `slots + 1`.
pub fn encode_triggers(triggers: &[Trigger]) -> [Report; 2] {
    let len = triggers.len() as u8 + 1;
    let mut payload = [0u8; 8];
    payload[0] = len;
    for (i, t) in triggers.iter().take(7).enumerate() {
        payload[i + 1] = matches!(t, Trigger::Press) as u8;
    }
    [[0x01, 0x85, len, 0, 0, 0, 0, 0], payload]
}

/// Decode the reply to `READ_TRIGGERS`: a length byte followed by one byte
/// per slot (1 = press, 0 = release), possibly spilling into a second report.
pub fn decode_triggers(reports: &[Report], slots: usize) -> Vec<Trigger> {
    reports
        .iter()
        .flatten()
        .skip(1)
        .take(slots)
        .map(|b| if *b == 0 { Trigger::Release } else { Trigger::Press })
        .collect()
}

pub fn decode_version(reports: &[Report]) -> String {
    let bytes: Vec<u8> = reports.iter().flatten().copied().take_while(|b| *b != 0).collect();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// Number of programmable slots for a firmware string, following the model
/// families the vendor app knows about. Unknown models default to 3.
pub fn slot_count(version: &str) -> u8 {
    const SIX: &[&str] = &["U2SW", "FS2020BT2", "HK6", "USW6"];
    const TWO: &[&str] = &["FootSwitch2", "FS2016B2A", "FS2016_B2_H", "FS2019_USB2"];
    if SIX.iter().any(|m| version.contains(m)) {
        6
    } else if TWO.iter().any(|m| version.contains(m)) {
        2
    } else {
        3
    }
}

/// Firmware newer than 3.4 stores a press/release trigger per slot.
pub fn supports_triggers(version: &str) -> bool {
    firmware_version(version).is_some_and(|v| v > 3.4)
}

fn firmware_version(version: &str) -> Option<f32> {
    let (_, v) = version.rsplit_once("_V")?;
    v.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Replies captured from an FS2020U1IR running firmware 5.7.
    const VERSION_REPLY: [Report; 2] = [
        [0x46, 0x53, 0x32, 0x30, 0x32, 0x30, 0x55, 0x31],
        [0x49, 0x52, 0x5f, 0x56, 0x35, 0x2e, 0x37, 0x00],
    ];
    const F15_HOLD: Report = [0x08, 0x01, 0x00, 0x6a, 0, 0, 0, 0];
    const TRIGGERS_REPLY: [Report; 2] = [[0x10, 1, 1, 1, 1, 1, 1, 1], [1; 8]];

    #[test]
    fn decodes_captured_version() {
        let v = decode_version(&VERSION_REPLY);
        assert_eq!(v, "FS2020U1IR_V5.7");
        assert_eq!(slot_count(&v), 3);
        assert!(supports_triggers(&v));
    }

    #[test]
    fn decodes_captured_slot() {
        let a = decode_action(&[F15_HOLD]);
        assert_eq!(a, Action::Key { modifiers: 0, key: 0x6a, mode: KeyMode::Hold });
    }

    #[test]
    fn key_round_trips() {
        for mode in [KeyMode::Hold, KeyMode::Tap] {
            // Ctrl+Shift+M
            let a = Action::Key { modifiers: 0x03, key: 0x10, mode };
            let report = encode_action(&a).unwrap();
            assert_eq!(decode_action(&[report]), a);
        }
        assert_eq!(encode_action(&Action::None).unwrap(), [0x08, 0x01, 0, 0, 0, 0, 0, 0]);
        assert_eq!(decode_action(&[encode_action(&Action::None).unwrap()]), Action::None);
    }

    #[test]
    fn unknown_types_are_preserved() {
        let mouse = [0x08, 0x02, 0, 0, 0x01, 0, 0, 0];
        assert_eq!(decode_action(&[mouse]), Action::Other { raw: mouse.to_vec() });
        assert!(encode_action(&decode_action(&[mouse])).is_none());
    }

    #[test]
    fn triggers() {
        assert_eq!(decode_triggers(&TRIGGERS_REPLY, 3), vec![Trigger::Press; 3]);
        let [header, payload] = encode_triggers(&[Trigger::Press, Trigger::Release, Trigger::Press]);
        assert_eq!(header, [0x01, 0x85, 4, 0, 0, 0, 0, 0]);
        assert_eq!(payload, [4, 1, 0, 1, 0, 0, 0, 0]);
    }
}
