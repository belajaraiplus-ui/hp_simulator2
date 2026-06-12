export const PIN_EDITOR_DEFAULT_RADIUS = 6;
export const PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX = 14;

export const PIN_TYPE_VALUES = new Set([
  "resistor",
  "capacitor",
  "diode",
  "mosfet",
  "ic",
  "fuse",
  "inductor",
  "jumper",
  "test_point",
  "passive",
  "signal",
  "power",
  "ground",
]);

export const PIN_ROLE_VALUES = new Set([
  "ground",
  "signal",
  "power",
  "passive",
  "test_point",
  "anode",
  "cathode",
  "gate",
  "drain",
  "source",
  "input",
  "output",
  "pin1",
  "pin2",
]);

export function normalizePinContact(pin = {}, fallbackId = "") {
  const x = Number(pin?.x ?? pin?.cx ?? pin?.px);
  const y = Number(pin?.y ?? pin?.cy ?? pin?.py);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const id = String(pin?.id || fallbackId || "").trim();
  return {
    id: id || fallbackId,
    name: pin?.name ?? pin?.label ?? null,
    x: Math.round(x),
    y: Math.round(y),
    radius: Number.isFinite(Number(pin?.radius)) && Number(pin.radius) > 0
      ? Number(pin.radius)
      : PIN_EDITOR_DEFAULT_RADIUS,
    node: pin?.node ?? null,
    railId: pin?.railId ?? pin?.rail ?? null,
    pinType: pin?.pinType ?? pin?.kind ?? null,
    pinRole: pin?.pinRole ?? null,
    isGround: Boolean(pin?.isGround),
    isTestPoint: Boolean(pin?.isTestPoint),
    componentId: pin?.componentId ?? null,
    authoringSource: pin?.authoringSource || "asset-import",
  };
}

export function inferPinDefaultsFromComponent(component, sequence = 1) {
  const kind = String(component?.kind || "").toLowerCase();
  const oneBased = Math.max(1, sequence);

  if (kind.includes("res") || kind === "resistor") {
    return { id: String(oneBased), name: String(oneBased), pinType: "resistor", pinRole: "passive" };
  }

  if (kind.includes("cap") || kind === "capacitor") {
    return { id: String(oneBased), name: String(oneBased), pinType: "capacitor", pinRole: "passive" };
  }

  if (kind.includes("diode") || kind === "di") {
    return oneBased === 1
      ? { id: "A", name: "A", pinType: "diode", pinRole: "anode" }
      : { id: "K", name: "K", pinType: "diode", pinRole: "cathode" };
  }

  if (kind.includes("mosfet") || kind === "fet") {
    const map = [
      { id: "G", name: "G", pinRole: "gate" },
      { id: "D", name: "D", pinRole: "drain" },
      { id: "S", name: "S", pinRole: "source" },
    ];
    const selected = map[(oneBased - 1) % map.length];
    return { ...selected, pinType: "mosfet" };
  }

  if (kind.includes("ic")) {
    return { id: String(oneBased), name: String(oneBased), pinType: "ic", pinRole: "signal" };
  }

  const generated = `PIN_${String(oneBased).padStart(3, "0")}`;
  return { id: generated, name: generated, pinType: null, pinRole: null };
}
