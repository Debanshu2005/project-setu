// Hardware abstraction layer. The core only ever talks to these interfaces.
//   firmware/  implements them with ESP32-S3 drivers (SX1262, NEO-6M, MPU-6050, ...)
//   simulation/ implements them with virtual sensors and a modelled RF channel
#pragma once
#include <cstddef>
#include <cstdint>

#include "setu/packet.hpp"

namespace setu {

enum class HapticPattern : uint8_t {
  PressRegistered,  // button edge accepted
  TierShort,        // general SOS recognised
  TierDouble,       // medical
  TierLong,         // trapped
  WakeDetected,     // "Setu" heard
  Reject,           // invalid press
  AckReceived,      // help acknowledged: continuous rhythm + LED flash
  SendFailed,       // retries exhausted without ACK
};

class IClock {
 public:
  virtual ~IClock() = default;
  virtual uint32_t now_ms() const = 0;   // monotonic, may wrap at 2^32
  virtual uint32_t unix_s() const = 0;   // GNSS-disciplined if available
};

class IRandom {
 public:
  virtual ~IRandom() = default;
  virtual uint32_t uniform(uint32_t max_exclusive) = 0;  // [0, max)
};

class IRadio {
 public:
  virtual ~IRadio() = default;
  // Start a transmission. False if the radio is busy; the core will retry.
  virtual bool send(const uint8_t* data, size_t len) = 0;
  // Channel-activity detection (listen-before-talk). Default: assume clear.
  virtual bool channel_busy() { return false; }
};

class IGnss {
 public:
  virtual ~IGnss() = default;
  virtual bool get_fix(int32_t& lat_e6, int32_t& lon_e6) = 0;  // false: no valid 3D fix
};

class IDeadReckoning {
 public:
  virtual ~IDeadReckoning() = default;
  virtual bool estimate(int32_t& lat_e6, int32_t& lon_e6) = 0;  // IMU-integrated estimate
};

class IBattery {
 public:
  virtual ~IBattery() = default;
  virtual uint8_t percent() = 0;
};

class IHaptic {
 public:
  virtual ~IHaptic() = default;
  virtual void play(HapticPattern p) = 0;
};

// Hub only: receives each new SOS that reaches it.
class IAlertSink {
 public:
  virtual ~IAlertSink() = default;
  virtual void on_alert(const Packet& p, uint32_t now_ms) = 0;
};

// Optional event tracing for simulator or instrumentation
class ITraceSink {
 public:
  virtual ~ITraceSink() = default;
  virtual void on_node_event(uint16_t node_id, const char* ev, const char* extra) = 0;
};

struct Hal {
  IClock* clock = nullptr;      // required
  IRandom* rng = nullptr;       // required
  IRadio* radio = nullptr;      // required
  IGnss* gnss = nullptr;        // optional
  IDeadReckoning* dr = nullptr; // optional
  IBattery* battery = nullptr;  // optional (reports 100 %)
  IHaptic* haptic = nullptr;    // optional
  IAlertSink* alerts = nullptr; // optional, hub only
  ITraceSink* trace = nullptr;  // optional, simulation/instrumentation
};

}  // namespace setu
