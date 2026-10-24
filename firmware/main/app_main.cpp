// ESP-IDF entry point for the real wristband.  NOT COMPILED YET: this is the wiring plan.
//
// The portable core (shared/) is added to the IDF build as a component. Everything below is the
// thin hardware layer: each class implements one setu::I* interface from shared/include/setu/hal.hpp.
//
//   setu::IClock          esp_timer_get_time() / GNSS UTC time
//   setu::IRandom         esp_random()
//   setu::IRadio          RadioLib SX1262: startTransmit(), scanChannel() for channel_busy()
//   setu::IGnss           NEO-6M on UART (NMEA GPRMC/GPGGA, 9600 baud) -> valid 3D fix only
//   setu::IDeadReckoning  MPU-6050 I2C + complementary filter, anchored to last GNSS fix
//   setu::IBattery        ADC divider on the LiPo / fuel estimate
//   setu::IHaptic         MOSFET-driven ERM motor + status LEDs (patterns from HapticPattern)
//
// Tasks (FreeRTOS):
//   button ISR   -> queue -> node.on_button_edge(level)      (GPIO interrupt, both edges)
//   audio task   -> ESP-SR WakeNet "Setu" -> node.on_wake_word()
//                   MultiNet (3.5 s window) -> node.on_voice_command(contact, hazard)
//   radio task   -> SX1262 DIO1 IRQ -> node.on_radio_rx(buf, len)
//   core task    -> node.tick() every 10 ms
//
// #include "setu/node.hpp"
//
// extern "C" void app_main() {
//   static EspClock clock; static EspRandom rng; static Sx1262Radio radio;
//   static NeoGnss gnss;   static ImuDr dr;      static Battery batt; static Haptics haptic;
//   setu::Hal hal{&clock, &rng, &radio, &gnss, &dr, &batt, &haptic, nullptr};
//   static setu::Node node(setu::NodeConfig{/*node_id from eFuse MAC*/}, hal);
//   // create tasks that call the node.on_* methods above, then loop node.tick() at 100 Hz
// }
