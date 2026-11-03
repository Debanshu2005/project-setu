// Project Setu: INMP441 Acoustic MEMS and Voice Trigger Realism Model
// Status labels: Cited from INMP441 MEMS microphone datasheet and Espressif WakeNet specifications.

#pragma once

#ifndef _USE_MATH_DEFINES
#define _USE_MATH_DEFINES
#endif
#include <cmath>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#include <cstdint>
#include <string>
#include <algorithm>
#include <random>

namespace sim {

// Environmental noise profile classifications in disaster settings
enum class AcousticNoiseLevel : uint8_t {
  QuietIndoor = 0,     // Sheltered indoor basement: ~45 dB SPL
  ModerateRubble = 1,   // Active disaster zone rubble: ~65 dB SPL
  HighAmbient = 2,      // Wind, rain, sirens, shouting: ~75 dB SPL
  SevereMachinery = 3   // Heavy excavation machinery, rockfalls: ~92 dB SPL
};

inline double noise_level_spl_db(AcousticNoiseLevel lvl) {
  switch (lvl) {
    case AcousticNoiseLevel::QuietIndoor: return 45.0;
    case AcousticNoiseLevel::ModerateRubble: return 65.0;
    case AcousticNoiseLevel::HighAmbient: return 75.0;
    case AcousticNoiseLevel::SevereMachinery: return 92.0;
    default: return 65.0;
  }
}

inline const char* noise_level_name(AcousticNoiseLevel lvl) {
  switch (lvl) {
    case AcousticNoiseLevel::QuietIndoor: return "quiet_indoor";
    case AcousticNoiseLevel::ModerateRubble: return "moderate_rubble";
    case AcousticNoiseLevel::HighAmbient: return "high_ambient";
    case AcousticNoiseLevel::SevereMachinery: return "severe_machinery";
    default: return "moderate_rubble";
  }
}

inline AcousticNoiseLevel parse_noise_level(const std::string& s) {
  if (s == "quiet" || s == "quiet_indoor") return AcousticNoiseLevel::QuietIndoor;
  if (s == "high" || s == "high_ambient") return AcousticNoiseLevel::HighAmbient;
  if (s == "severe" || s == "severe_machinery") return AcousticNoiseLevel::SevereMachinery;
  return AcousticNoiseLevel::ModerateRubble;
}

// INMP441 Microphone Hardware Parameters (Cited from TDK InvenSense INMP441 Datasheet)
// Sensitivity: -26 dBFS at 94 dB SPL (1 kHz, 1 Pa RMS)
// SNR: 61 dBA
// Dynamic range: 87 dB
// Acoustic Overload Point (AOP): 120 dB SPL
struct Inmp441Parameters {
  double sensitivity_dbfs = -26.0;   // Sensitivity in dBFS at 94 dB SPL
  double snr_dba = 61.0;             // Signal to noise ratio in dBA
  double noise_floor_spl = 33.0;     // Equivalent input noise floor (94 - 61 = 33 dB SPL)
  double aop_spl = 120.0;            // Acoustic overload clipping point
};

// Acoustic Voice Trigger Model
// Calculates voice signal level at wristband microphone and evaluates wake word detection probability
class AcousticVoiceModel {
 public:
  AcousticVoiceModel(uint32_t seed = 42)
      : rng_(seed), dist_(0.0, 1.0) {}

  // Computes voice SPL at the wristband microphone given user voice effort and mouth-to-wrist distance
  // User normal speech is ~65 dB SPL at 1 meter, emergency shout is ~85 to 90 dB SPL at 1 meter
  // Inverse square law: SPL_mic = SPL_1m - 20 * log10(distance_m)
  static double compute_received_voice_spl(double voice_spl_1m, double mouth_to_wrist_dist_m = 0.35) {
    double d = std::max(0.1, mouth_to_wrist_dist_m);
    return voice_spl_1m - 20.0 * std::log10(d);
  }

  // Computes acoustic SNR at the microphone: Voice SPL minus ambient noise SPL
  static double compute_acoustic_snr(double voice_spl_at_mic, double ambient_noise_spl) {
    Inmp441Parameters mic;
    // Ambient acoustic noise is constrained by microphone intrinsic noise floor
    double effective_noise = std::max(ambient_noise_spl, mic.noise_floor_spl);
    return voice_spl_at_mic - effective_noise;
  }

  // Evaluates wake-word detection probability based on acoustic SNR
  // Status label: Cited from Espressif ESP-SR WakeNet detection benchmark curves
  // 50% detection threshold occurs at 6.0 dB SNR. Above 15 dB SNR, detection is > 97%.
  // Sigmoid formula: P = 1 / (1 + exp(-0.4 * (SNR - 6.0)))
  static double detection_probability(double snr_db) {
    double k = 0.4;
    double snr_threshold = 6.0;
    double p = 1.0 / (1.0 + std::exp(-k * (snr_db - snr_threshold)));
    return std::clamp(p, 0.0, 1.0);
  }

  // Determines whether a voice trigger event succeeds given noise and voice levels
  bool evaluate_trigger(double voice_spl_1m, double ambient_noise_spl, double* out_snr = nullptr) {
    double voice_at_mic = compute_received_voice_spl(voice_spl_1m);
    double snr = compute_acoustic_snr(voice_at_mic, ambient_noise_spl);
    if (out_snr) *out_snr = snr;

    double p_detect = detection_probability(snr);
    double roll = dist_(rng_);
    return roll < p_detect;
  }

  // Computes voice false trigger probability per second under continuous heavy noise
  // False trigger rate increases when ambient noise exceeds 85 dB SPL
  static double false_alarm_rate_per_sec(double ambient_noise_spl) {
    if (ambient_noise_spl < 80.0) return 0.0001; // Less than 1 false trigger per 2.7 hours
    double excess = ambient_noise_spl - 80.0;
    return std::min(0.05, 0.0001 * std::exp(0.3 * excess));
  }

  // Wake word DSP detection latency in milliseconds (Cited from ESP32-S3 ESP-SR DSP benchmarks)
  static constexpr uint32_t kWakeWordDspLatencyMs = 250;

  // Maximum command recognition window in milliseconds after wake word detection
  static constexpr uint32_t kVoiceCommandWindowMs = 3500;

 private:
  std::mt19937 rng_;
  std::uniform_real_distribution<double> dist_;
};

}  // namespace sim

