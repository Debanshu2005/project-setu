// Adapted from esp-labs-web (https://github.com/agharsallah/esp-labs-web), MIT License,
// Copyright (c) 2026 Abderrehmen Gharsallah. Original file: src/domain/board.ts.
// Changes: TypeScript types removed, import paths rewritten. See THIRD_PARTY_NOTICE.txt.
const HEADER = {
  L: [
    "3V3",
    "3V3",
    "RST",
    "4",
    "5",
    "6",
    "7",
    "15",
    "16",
    "17",
    "18",
    "8",
    "3",
    "46",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "5V",
    "GND"
  ],
  R: [
    "GND",
    "43",
    "44",
    "1",
    "2",
    "42",
    "41",
    "40",
    "39",
    "38",
    "37",
    "36",
    "35",
    "0",
    "45",
    "48",
    "47",
    "21",
    "20",
    "19",
    "GND",
    "GND"
  ]
};
const ALIAS = { "43": "TX 43", "44": "RX 44" };
const AVOID = /* @__PURE__ */ new Set(["0", "3", "45", "46", "19", "20", "35", "36", "37", "43", "44"]);
function classifyPin(pin) {
  if (pin === "3V3" || pin === "5V") return "power";
  if (pin === "GND") return "gnd";
  if (pin === "RST" || AVOID.has(pin)) return "avoid";
  return "safe";
}
const pinLabel = (pin) => ALIAS[pin] ?? pin;
const pinIndex = (use) => use.idx ?? HEADER[use.side].indexOf(use.pin);
export {
  HEADER,
  classifyPin,
  pinIndex,
  pinLabel
};
