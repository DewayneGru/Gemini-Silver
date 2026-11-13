#ifndef SYNAPSE_STDP_HPP
#define SYNAPSE_STDP_HPP

#include <algorithm>
#include <cmath>
#include <cstdint>

#define SYNAPSE_STATE_DEFINED 1

struct alignas(64) SynapseState {
    double weight = 0.685;
    double last_pre_ts = -1.0;
    double last_post_ts = -1.0;
    double trace_pre = 0.0;
    double trace_post = 0.0;
    double w_min = 0.0;
    double w_max = 1.0;
    double max_delta_w = 0.05;

    bool apply_stdp(double pre_ts, double post_ts, double tau_ms) noexcept {
        if (!std::isfinite(pre_ts) || !std::isfinite(post_ts) || !std::isfinite(tau_ms) || tau_ms <= 0.0) {
            return false;
        }
        // Reject non-monotonic timestamps
        if ((last_pre_ts >= 0.0 && pre_ts < last_pre_ts) ||
            (last_post_ts >= 0.0 && post_ts < last_post_ts)) {
            return false;
        }

        const double dt = post_ts - pre_ts;
        double raw_dw = 0.0;
        if (dt >= 0.0) {
            raw_dw = 0.025 * std::exp(-dt / tau_ms);
        } else {
            raw_dw = -0.026 * std::exp(dt / tau_ms);
        }

        if (!std::isfinite(raw_dw)) {
            return false;
        }

        const double clamped_dw = std::max(-max_delta_w, std::min(max_delta_w, raw_dw));
        const double next_w = std::max(w_min, std::min(w_max, weight + clamped_dw));
        if (!std::isfinite(next_w)) {
            return false;
        }

        weight = next_w;
        last_pre_ts = pre_ts;
        last_post_ts = post_ts;
        return true;
    }
};

static_assert(alignof(SynapseState) == 64, "SynapseState must maintain 64-byte cache-line alignment");

#endif // SYNAPSE_STDP_HPP
