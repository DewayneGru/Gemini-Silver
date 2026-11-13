#ifndef SYNAPSE_STDP_HPP
#define SYNAPSE_STDP_HPP

#include <algorithm>
#include <cmath>
#include <cstdint>

#define SYNAPSE_STATE_DEFINED 1

struct alignas(64) SynapseState {
    double weight = 0.685;       // [0..7]   Excitatory synaptic weight
    double last_pre_ts = -1.0;   // [8..15]  Last monotonic presynaptic timestamp (ms)
    double last_post_ts = -1.0;  // [16..23] Last monotonic postsynaptic timestamp (ms)
    double last_inh_ts = -1.0;   // [24..31] Last monotonic inhibitory update timestamp (ms)
    double g_inh = 0.35;         // [32..39] Dynamic cross-homeostatic inhibitory gain
    double max_delta_w = 0.05;   // [40..47] Per-step excitatory plasticity clamp
    float w_min = 0.0f;          // [48..51] Lower excitatory weight bound
    float w_max = 1.0f;          // [52..55] Upper excitatory weight bound
    float trace_pre = 0.0f;      // [56..59] Compact presynaptic eligibility trace
    float trace_post = 0.0f;     // [60..63] Compact postsynaptic eligibility trace

    static constexpr double kGMin = 0.05;
    static constexpr double kGMax = 2.00;
    static constexpr double kMaxDeltaG = 0.04;
    static constexpr double kRTarget = 0.48;
    static constexpr double kSigmaTarget = 1.00;

    bool apply_stdp(double pre_ts, double post_ts, double tau_ms) noexcept {
        if (!std::isfinite(pre_ts) || !std::isfinite(post_ts) || !std::isfinite(tau_ms) || tau_ms <= 0.0) {
            return false;
        }
        if ((last_pre_ts >= 0.0 && pre_ts < last_pre_ts) ||
            (last_post_ts >= 0.0 && post_ts < last_post_ts)) {
            return false;
        }

        const double dt = post_ts - pre_ts;
        const double raw_dw = (dt >= 0.0)
            ? (0.025 * std::exp(-dt / tau_ms))
            : (-0.026 * std::exp(dt / tau_ms));

        if (!std::isfinite(raw_dw)) {
            return false;
        }

        const double clamped_dw = std::max(-max_delta_w, std::min(max_delta_w, raw_dw));
        const double lo = static_cast<double>(w_min);
        const double hi = static_cast<double>(w_max);
        const double next_w = std::max(lo, std::min(hi, weight + clamped_dw));
        if (!std::isfinite(next_w)) {
            return false;
        }

        weight = next_w;
        last_pre_ts = pre_ts;
        last_post_ts = post_ts;
        return true;
    }

    bool update_inhibitory_gain(
        double spike_ts,
        double sigma_branch,
        double order_param_r,
        double tau_inh_ms,
        double eta_inh = 0.02,
        double alpha_r = 0.45,
        double beta_rec = 0.12
    ) noexcept {
        if (!std::isfinite(spike_ts) || !std::isfinite(sigma_branch) ||
            !std::isfinite(order_param_r) || !std::isfinite(tau_inh_ms) ||
            !std::isfinite(eta_inh) || !std::isfinite(alpha_r) ||
            !std::isfinite(beta_rec)) {
            return false;
        }
        if (tau_inh_ms <= 0.0 || eta_inh <= 0.0 || sigma_branch < 0.0 ||
            order_param_r < 0.0 || order_param_r > 1.0) {
            return false;
        }
        if (last_inh_ts >= 0.0 && spike_ts < last_inh_ts) {
            return false;
        }

        const double dt_spike = (last_inh_ts >= 0.0) ? (spike_ts - last_inh_ts) : 0.0;
        const double kernel_decay = std::exp(-dt_spike / tau_inh_ms);
        const double err_sigma = sigma_branch - kSigmaTarget;
        const double err_r = order_param_r - kRTarget;

        // Sub-critical recovery prevents locking into a silent absorbing state (sigma < 1.0)
        const double subcritical_pull =
            (sigma_branch < kSigmaTarget)
                ? -beta_rec * (kSigmaTarget - sigma_branch) * (g_inh - kGMin)
                : 0.0;

        const double raw_dg =
            eta_inh * (err_sigma * kernel_decay + alpha_r * err_r) + subcritical_pull;

        if (!std::isfinite(raw_dg)) {
            return false;
        }

        const double clamped_dg = std::max(-kMaxDeltaG, std::min(kMaxDeltaG, raw_dg));
        const double next_g = std::max(kGMin, std::min(kGMax, g_inh + clamped_dg));
        if (!std::isfinite(next_g)) {
            return false;
        }

        g_inh = next_g;
        last_inh_ts = spike_ts;
        return true;
    }
};

static_assert(alignof(SynapseState) == 64, "SynapseState must maintain 64-byte cache-line alignment");
static_assert(sizeof(SynapseState) == 64, "SynapseState must fit within a single 64-byte cache line");

#endif // SYNAPSE_STDP_HPP
