use std::thread::sleep;
use std::time::Duration;

use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};

use super::protocol::{self, Action, Report, Trigger};

/// VID/PID pairs that speak this protocol (from rgerganov/footswitch).
const SUPPORTED: &[(u16, u16)] = &[
    (0x3553, 0xb001),
    (0x0c45, 0x7403),
    (0x0c45, 0x7404),
    (0x413d, 0x2107),
    (0x1a86, 0xe026),
];

/// The configuration channel is always on USB interface 1; interface 0 is the
/// keyboard/mouse the pedal pretends to be.
const CONFIG_INTERFACE: i32 = 1;

/// Pause after each write. The firmware drops commands sent back to back.
const WRITE_GAP: Duration = Duration::from_millis(30);
const READ_TIMEOUT_MS: i32 = 300;

#[derive(Debug, thiserror::Error)]
pub enum PedalError {
    #[error("No foot switch found. Plug it in, and close the PCsensor app if it's open.")]
    NotFound,
    #[error("USB error: {0}")]
    Hid(#[from] hidapi::HidError),
    #[error("Slot {0} doesn't exist on this pedal")]
    BadSlot(u8),
    #[error("Slot {0} uses an action Treadle can't edit yet")]
    NotEditable(u8),
}

impl Serialize for PedalError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, PedalError>;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    /// 1-based, as the pedal numbers them.
    pub index: u8,
    pub action: Action,
    /// `None` when the firmware has no per-slot trigger setting.
    pub trigger: Option<Trigger>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PedalState {
    pub vendor_id: u16,
    pub product_id: u16,
    pub firmware: String,
    pub slots: Vec<Slot>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlotUpdate {
    pub index: u8,
    pub action: Action,
    pub trigger: Option<Trigger>,
}

pub struct Pedal {
    dev: HidDevice,
    vendor_id: u16,
    product_id: u16,
}

pub fn is_connected(api: &mut HidApi) -> bool {
    api.refresh_devices().is_ok() && find_config_path(api).is_some()
}

fn find_config_path(api: &HidApi) -> Option<(std::ffi::CString, u16, u16)> {
    api.device_list()
        .find(|d| {
            d.interface_number() == CONFIG_INTERFACE
                && SUPPORTED.contains(&(d.vendor_id(), d.product_id()))
        })
        .map(|d| (d.path().to_owned(), d.vendor_id(), d.product_id()))
}

impl Pedal {
    pub fn open(api: &mut HidApi) -> Result<Self> {
        api.refresh_devices()?;
        let (path, vendor_id, product_id) = find_config_path(api).ok_or(PedalError::NotFound)?;
        let dev = api.open_path(&path)?;
        Ok(Self { dev, vendor_id, product_id })
    }

    fn send(&self, report: Report) -> Result<()> {
        // hidapi wants the report ID first; this interface has none, so 0.
        let mut buf = [0u8; 9];
        buf[1..].copy_from_slice(&report);
        self.dev.write(&buf)?;
        sleep(WRITE_GAP);
        Ok(())
    }

    /// Collect every report the pedal sends until it goes quiet.
    fn receive(&self) -> Result<Vec<Report>> {
        let mut out = Vec::new();
        let mut buf = [0u8; 64];
        loop {
            let n = self.dev.read_timeout(&mut buf, READ_TIMEOUT_MS)?;
            if n == 0 {
                return Ok(out);
            }
            let mut report = [0u8; 8];
            let len = n.min(8);
            report[..len].copy_from_slice(&buf[..len]);
            out.push(report);
        }
    }

    fn query(&self, report: Report) -> Result<Vec<Report>> {
        self.drain()?;
        self.send(report)?;
        self.receive()
    }

    fn drain(&self) -> Result<()> {
        let mut buf = [0u8; 64];
        while self.dev.read_timeout(&mut buf, 10)? > 0 {}
        Ok(())
    }

    pub fn read_state(&self) -> Result<PedalState> {
        let firmware = protocol::decode_version(&self.query(protocol::READ_VERSION)?);
        let count = protocol::slot_count(&firmware);
        let triggers = if protocol::supports_triggers(&firmware) {
            let t = protocol::decode_triggers(&self.query(protocol::READ_TRIGGERS)?, count as usize);
            Some(t)
        } else {
            None
        };
        let mut slots = Vec::with_capacity(count as usize);
        for index in 1..=count {
            let action = protocol::decode_action(&self.query(protocol::read_slot(index))?);
            let trigger = triggers.as_ref().and_then(|t| t.get(index as usize - 1).copied());
            slots.push(Slot { index, action, trigger });
        }
        Ok(PedalState {
            vendor_id: self.vendor_id,
            product_id: self.product_id,
            firmware,
            slots,
        })
    }

    /// Write the given slots. Slots not listed are left exactly as they are.
    pub fn write(&self, updates: &[SlotUpdate]) -> Result<PedalState> {
        let current = self.read_state()?;
        if updates.is_empty() {
            return Ok(current);
        }
        for u in updates {
            let slot = current
                .slots
                .iter()
                .find(|s| s.index == u.index)
                .ok_or(PedalError::BadSlot(u.index))?;
            if !u.action.is_editable() && u.action != slot.action {
                return Err(PedalError::NotEditable(u.index));
            }
        }

        self.send(protocol::BEGIN_WRITE)?;
        sleep(Duration::from_millis(100));
        for u in updates {
            if let Some(data) = protocol::encode_action(&u.action) {
                self.send(protocol::write_slot_header(u.index))?;
                self.send(data)?;
            }
        }

        // Triggers are stored as one block, so merge the updates over what's
        // on the pedal and write them all back.
        if current.slots.iter().all(|s| s.trigger.is_some()) {
            let triggers: Vec<Trigger> = current
                .slots
                .iter()
                .map(|s| {
                    updates
                        .iter()
                        .find(|u| u.index == s.index)
                        .and_then(|u| u.trigger)
                        .or(s.trigger)
                        .unwrap_or(Trigger::Press)
                })
                .collect();
            let [header, payload] = protocol::encode_triggers(&triggers);
            self.send(header)?;
            sleep(Duration::from_millis(200));
            self.send(payload)?;
        }

        sleep(Duration::from_millis(500));
        self.read_state()
    }
}
