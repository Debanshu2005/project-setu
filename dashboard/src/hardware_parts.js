// Project Setu: Hardware Explorer Part Catalog
const p = (id, number, title, subtitle, side, what, why, pins, simulator, provenance, chips) =>
  ({ id, number, title, subtitle, side, what, why, pins, simulator, provenance, chips });
const pv = (fact, tag, source, paramLink) => (paramLink ? { fact, tag, source, paramLink } : { fact, tag, source });
const ch = (label, action, paramLink) => (paramLink ? { label, action, paramLink } : { label, action });

export const DEVKITC_PARTS = [
  p('usb', 1, 'USB-C Dual Ports', 'Flashing & Serial Telemetry Bridge', 'left',
    'Dual USB-C ports providing USB-JTAG debugging and CP2102N serial console.',
    'Enables rapid bench flashing, FreeRTOS task traces, and telemetry logging.',
    'USB-D+/D- on GPIO 19/20, UART0 TX on GPIO 43 and RX on GPIO 44.',
    'Watch console stream for task states, queue allocs, and radio IRQs.',
    [pv('Baud rate 115200 bps', 'cited', 'ESP32-S3 TRM Rev 1.4'), pv('USB 2.0 12 Mbps PHY', 'cited', 'ESP32-S3 Datasheet')],
    [ch('Firmware console: open Timeline', 'timeline'), ch('Flash parameters: view Docs', 'docs', 'docs/PARAMETERS.md#1-provenance-classification-rules')]
  ),
  p('buttons', 2, 'BOOT and RST Switches', 'Prototype Trigger & Strapping Pin Caveat', 'left',
    'Pushbuttons for reset (CHIP_PU) and boot mode selection (GPIO 0).',
    'Tactile panic input. GPIO 0 is a strapping pin; low at reset enters download mode.',
    'GPIO 0 (BOOT, strapping pull-up) and CHIP_PU. Product uses GPIO 16.',
    'Click button on 3D model or choose Press/Double/Long to trigger SOS flows.',
    [pv('Short press <500 ms', 'cited', 'Setu Spec 4.2', 'docs/PARAMETERS.md'), pv('Double press gap <400 ms', 'cited', 'Setu Spec 4.2'), pv('Long press threshold 1500 ms', 'cited', 'Setu Spec 4.2'), pv('Bootloader mode low on reset', 'cited', 'ESP32-S3 Datasheet Table 2-4')],
    [ch('Button state machine: open Timeline', 'timeline'), ch('Trigger SOS: test in Twin', 'twin')]
  ),
  p('rgb', 3, 'Status RGB Beacon', 'WS2812 Visual Telemetry', 'left',
    'Addressable RGB LED (WS2812B) driven via RMT peripheral.',
    'Delivers optical feedback confirming packet transmission, routing, and ACK receipt.',
    'GPIO 48 (WS2812 data line driven by ESP32-S3 RMT channel).',
    'LED shifts from teal (idle) to amber (TX), cyan (wait), green (ACK), coral (retry).',
    [pv('WS2812 800 kHz timing', 'cited', 'WS2812B Datasheet'), pv('Peak draw 45 mA white', 'model', 'Energy Model 3.1', 'docs/PARAMETERS.md')],
    [ch('LED sequence: open Timeline', 'timeline'), ch('Energy impact: open Energy chart', 'energy')]
  ),
  p('module', 4, 'ESP32-S3 WROOM-1', 'Dual-Core Xtensa LX7 & Vector AI', 'right',
    'MCU with dual 240 MHz Xtensa LX7 cores, vector AI, 512 KB SRAM, 8 MB PSRAM.',
    'Runs WakeNet speech detection, dead reckoning filters, and mesh routing.',
    'Octal SPI bus pins (GPIO 33-37 reserved for flash/PSRAM).',
    'Observe processor state, dual-core task scheduling, and dead-reckoning trajectory.',
    [pv('MCU active draw 20 mA', 'model', 'Energy Spec', 'docs/PARAMETERS.md'), pv('Deep sleep current 12 uA', 'cited', 'ESP32-S3 Datasheet')],
    [ch('Dead reckoning filter: open PDR', 'pdr'), ch('Architecture: open Analytics', 'analytics')]
  ),
  p('antenna', 5, 'Meander PCB Antenna', '2.4 GHz Wi-Fi and BLE Radiator', 'right',
    'Inverted-F meandered trace antenna tuned for 2.4 GHz ISM band operations.',
    'Provides short-range Wi-Fi/BLE. BLE short-hop tier is not implemented in simulator.',
    'Internal RF output pin of the ESP32-S3 package.',
    'Emits radio waves. BLE short-hop is labeled as not implemented in current engine.',
    [pv('Peak gain 2.0 dBi at 2.45 GHz', 'cited', 'ESP32-S3 Datasheet'), pv('BLE short-hop tier status', 'assumed', 'Roadmap pending Phase 4')],
    [ch('Propagation: open Analytics', 'analytics'), ch('Transceiver: open 3D twin', 'twin')]
  ),
  p('headers', 6, 'DevKitC-1 Pin Headers', '44-Pin Peripheral Bus Interface', 'right',
    'Two 22-pin headers bringing out power rails and 36 general purpose digital/analog pins.',
    'Interconnects external modules: LoRa (SPI), GNSS (UART), IMU (I2C), mic (I2S), motor (PWM).',
    'SPI: GPIO 5,6,7,8; UART: 17,18; I2C: 21,9; I2S: 41,42,38; PWM: 13; ADC: 1; Panic: 16.',
    'Toggle Wiring View overlay to inspect individual pins color-coded by communication bus.',
    [pv('Pin map in pinmap.json', 'cited', 'firmware/pinmap.json'), pv('GPIO 9 selected for I2C SCL', 'model', 'Hardware Explorer Decision H5')],
    [ch('Wiring overlay: inspect Pins', 'wiring'), ch('Mesh topology: open Map', 'topology')]
  )
];

export const WRISTBAND_PARTS = [
  p('strap', 1, 'Silicone Strap & Housing', 'IP67 Ingress Protected Wearable', 'left',
    'Silicone rubber strap molded around a sealed polycarbonate-ABS reinforced core.',
    'Guarantees mechanical survival, dust exclusion, and water submersion to 1 meter depth.',
    'Passive mechanical housing enclosure; no GPIO lines.',
    'Observe the wristband in 3D orbit, verifying sealed geometry and sensor placement.',
    [pv('IP67 immersion 1.0 m 30 min', 'cited', 'IEC 60529 IP Standard'), pv('Body shadow attenuation 15 dB', 'cited', 'IEEE Trans. Antennas', 'docs/PARAMETERS.md')],
    [ch('Survivor wearable: view in Twin', 'twin'), ch('Enclosure specs: view Docs', 'docs', 'docs/PARAMETERS.md')]
  ),
  p('buttons', 2, 'Sealed Panic Button', 'Dedicated Non-Strapping Trigger', 'left',
    'Sealed tactile dome switch with silicon membrane overlay, recessed 1.2 mm.',
    'Allows immediate tactile origination of SOS beacons on safe GPIO 16, avoiding strapping risk.',
    'GPIO 16 (dedicated input with 45 kOhm pull-up, active low, dual-edge ISR).',
    'Click button on wristband face to test short, double, or long press emergency dispatches.',
    [pv('Actuation force nominal 2.5 N', 'cited', 'C&K KSC Datasheet'), pv('Hardware debounce 20 ms', 'cited', 'firmware/main/app_main.cpp')],
    [ch('Button state machine: open Timeline', 'timeline'), ch('Trigger live beacon: test in Twin', 'twin')]
  ),
  p('rgb', 3, 'Tri-Color LED Array', 'High-Visibility Optical Beacon', 'left',
    'Trio of ultra-bright wide-angle LEDs recessed beneath a diffusion prism.',
    'Provides unequivocal confirmation that an emergency beacon was acknowledged by a rescue hub.',
    'GPIO 48 (WS2812 addressable chain or discrete driver GPIO 14/15).',
    'Displays light patterns matching firmware states: idle, SOS active, ACK confirmed, dead.',
    [pv('Intensity 1200 mcd per emitter', 'cited', 'LUXEON Datasheet'), pv('Current draw 15 mA per channel', 'model', 'Energy Model 3.2', 'docs/PARAMETERS.md')],
    [ch('LED timeline: open Timeline', 'timeline'), ch('Power drain: open Energy chart', 'energy')]
  ),
  p('mic', 4, 'Acoustic MEMS Mic', 'INMP441 Omnidirectional Sensor', 'right',
    'Low-power digital I2S omnidirectional microphone with bottom acoustic port.',
    'Allows hands-free voice emergency dispatch ("Say Setu") for trapped survivors.',
    'I2S Bus: SCK on GPIO 41, WS on GPIO 42, SD on GPIO 38.',
    'Use Say Setu trigger to test acoustic emergency flow, starting a 10s confirmation window.',
    [pv('Sampling rate 16 kHz 24-bit', 'cited', 'INMP441 Product Spec'), pv('Voice fallback window 10.0 s', 'model', 'Voice Protocol Spec')],
    [ch('Voice trigger: test in Twin', 'twin'), ch('Audio pipeline: open Analytics', 'analytics')]
  ),
  p('antenna', 5, 'Sub-GHz LoRa Antenna', 'SX1262 868 MHz Resonator', 'right',
    'Flexible printed circuit (FPC) Sub-GHz antenna tuned for 868.100 MHz European SRD band.',
    'Primary long-range mesh radio link, capable of penetrating concrete walls and rubble.',
    'Connected to SX1262 via IPEX (SPI on GPIO 5,6,7,8; DIO1 on 4; Reset on 3; Busy on 2).',
    'Emits animated radio wave arcs during transmission, scaled proportionally to real airtime.',
    [pv('Frequency 868.100 MHz', 'cited', 'Sub-GHz SRD Presets', 'docs/PARAMETERS.md'), pv('TX power +14 dBm nominal', 'model', 'SX1262 Conditions', 'docs/PARAMETERS.md'), pv('Airtime 56.6 ms at SF7 125 kHz', 'model', 'LoRa Formulations', 'docs/PARAMETERS.md')],
    [ch('Airtime ring: inspect 3D twin', 'twin'), ch('Waterfall: open Analytics', 'analytics')]
  ),
  p('gnss', 6, 'GNSS Ceramic Patch', 'NEO-6M 15x15mm Satellite Antenna', 'right',
    'Ceramic patch antenna coupled to a u-blox NEO-6M GNSS receiver for GPS/QZSS tracking.',
    'Supplies absolute geodetic coordinates (lat/lon) for positioning and dead-reckoning anchoring.',
    'UART1 Bus: TX on GPIO 17, RX on GPIO 18 (9600 baud NMEA).',
    'Indicates satellite lock status (Fixed, Lost, Dead-Reckoning) with position error uncertainty.',
    [pv('Horizontal accuracy 2.5 m CEP', 'cited', 'NEO-6M Manual Rev R15'), pv('Active receiver draw 25 mA', 'model', 'Energy Model 2.4', 'docs/PARAMETERS.md#3-energy-model-bench-parameters')],
    [ch('Positioning: open Analytics', 'analytics'), ch('GPS denial: test in Twin', 'twin')]
  )
];

export const BUS_COLORS = {
  spi: { name: 'SPI (LoRa)', color: '#38bdf8' },
  uart: { name: 'UART (GNSS)', color: '#34d399' },
  i2c: { name: 'I2C (IMU)', color: '#fbbf24' },
  i2s: { name: 'I2S (Mic)', color: '#c084fc' },
  pwm: { name: 'PWM (Haptic)', color: '#fb923c' },
  adc: { name: 'ADC (Battery)', color: '#f472b6' },
  gpio: { name: 'GPIO (Button)', color: '#f87171' },
  irq: { name: 'IRQ (Radio)', color: '#60a5fa' }
};
