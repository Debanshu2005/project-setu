import assert from 'node:assert/strict';
import fs from 'node:fs';

const map = JSON.parse(fs.readFileSync(new URL('../firmware/pinmap.json', import.meta.url), 'utf8'));

// ESP32-S3 DevKitC-1 physical header pin GPIO list
const headerGpios = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48
]);

// Strapping pins on ESP32-S3 per datasheet Table 2-4
const strappingPins = new Set([0, 3, 45, 46]);

// Flash / Octal PSRAM internal pins on ESP32-S3 N16R8
const reservedFlashPsram = new Set([26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);

// 1. Validate all peripheral pins are on physical header
const seenGpios = new Set();
for (const pin of map.pins) {
  assert(headerGpios.has(pin.gpio), `GPIO ${pin.gpio} (${pin.name}) must be present on DevKitC-1 header`);
  assert(!seenGpios.has(pin.gpio), `GPIO ${pin.gpio} must be used only once; duplicate found on ${pin.name}`);
  seenGpios.add(pin.gpio);

  // If a pin is a strapping pin or reserved flash/psram pin, verify an explicit documented waiver
  if (strappingPins.has(pin.gpio) || reservedFlashPsram.has(pin.gpio)) {
    assert(typeof pin.waiver === 'string' && pin.waiver.trim().length > 0,
      `Pin GPIO ${pin.gpio} (${pin.name}) is a strapping or reserved pin and requires a documented waiver`);
  }
}

// 2. Negative test: GPIO 22 must FAIL header validation
assert.equal(headerGpios.has(22), false, 'GPIO 22 must NOT be present on DevKitC-1 header');
function validateCandidatePin(gpio) {
  if (!headerGpios.has(gpio)) {
    throw new Error(`GPIO ${gpio} is not on DevKitC-1 header`);
  }
}
assert.throws(() => validateCandidatePin(22), /GPIO 22 is not on DevKitC-1 header/);

// 3. Verify selected pins for key peripherals
const imuScl = map.pins.find(pin => pin.name === 'imu_scl');
assert.equal(imuScl.gpio, 9, 'IMU SCL must be relocated to GPIO 9 on DevKitC-1 header');
const panicBtn = map.pins.find(pin => pin.name === 'panic_button');
assert.equal(panicBtn.gpio, 16, 'Production panic button must use dedicated safe GPIO 16');

// 4. Verify prototype strapping risk entry
assert(map.prototype_only, 'prototype_only block must exist');
assert.equal(map.prototype_only.boot_button_gpio, 0);
assert(typeof map.prototype_only.risk === 'string' && map.prototype_only.risk.length > 0);
assert(typeof map.prototype_only.waiver === 'string' && map.prototype_only.waiver.length > 0);

// 5. Verify alternatives evaluated documentation for GPIO 22
assert(map.alternatives_evaluated?.imu_scl, 'alternatives_evaluated for imu_scl must exist');
assert.equal(map.alternatives_evaluated.imu_scl.rejected_gpio, 22);
assert.equal(map.alternatives_evaluated.imu_scl.evaluated_options.find(o => o.status === 'selected').gpio, 9);

// 6. Verify firmware adapter source consistency
const firmwareAdapters = fs.readFileSync(new URL('../firmware/esp32s3/include/esp32_adapters.hpp', import.meta.url), 'utf8');
assert(firmwareAdapters.includes('Mpu6050DeadReckoning(int sda_pin = 21, int scl_pin = 9)'),
  'esp32_adapters.hpp Mpu6050DeadReckoning default constructor must specify GPIO 9 for SCL');

const appMain = fs.readFileSync(new URL('../firmware/main/app_main.cpp', import.meta.url), 'utf8');
assert(appMain.includes('s_radio(5 /*CS*/, 4 /*IRQ*/, 3 /*RST*/, 2 /*BUSY*/);'),
  'app_main.cpp radio pins must match pin map');
assert(appMain.includes('s_gnss(1 /*UART1*/, 17 /*TX*/, 18 /*RX*/);'),
  'app_main.cpp GNSS pins must match pin map');
assert(appMain.includes('s_dr(21 /*SDA*/, 9 /*SCL*/);'),
  'app_main.cpp IMU pins must match pin map (GPIO 21 SDA, GPIO 9 SCL)');
assert(appMain.includes('s_haptics(13 /*MOTOR*/, 14 /*LED_R*/, 15 /*LED_G*/);'),
  'app_main.cpp haptic and LED pins must match pin map');
assert(appMain.includes('GPIO_NUM_16'),
  'app_main.cpp must configure GPIO 16 for panic button');

console.log('[ PASS ] Pin map validator passed: header GPIOs, uniqueness, negative GPIO 22 rejection, waivers, and firmware agreement verified.');
