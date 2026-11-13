// tests/test_synapse_stdp.cpp
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "synapse_stdp.hpp"

// Compile-time hardware cache-line invariants
static_assert(alignof(SynapseState) == 64, "SynapseState must maintain 64-byte alignment");
static_assert(sizeof(SynapseState) == 64, "SynapseState must fit inside a single 64-byte cache line");
static_assert(offsetof(SynapseState, trace_post) == 60, "SynapseState field layout drifted from 64-byte packing");

namespace {

struct TestResult {
    std::string name;
    bool passed;
    std::string detail;
};

bool approx_equal(double a, double b, double eps = 1e-12) noexcept {
    return std::fabs(a - b) <= eps;
}

bool state_exact_match(const SynapseState& a, const SynapseState& b) noexcept {
    return std::memcmp(&a, &b, sizeof(SynapseState)) == 0;
}

// 1. Verify sizeof/alignof(SynapseState) == 64 and contiguous vector alignment
TestResult test_cache_line_alignment() {
    SynapseState single{};
    std::vector<SynapseState> pool(16);

    const auto single_addr = reinterpret_cast<std::uintptr_t>(&single);
    if ((single_addr % 64) != 0) {
        return {"cache_line_alignment", false, "Stack SynapseState address is not 64-byte aligned."};
    }

    for (std::size_t i = 0; i < pool.size(); ++i) {
        const auto elem_addr = reinterpret_cast<std::uintptr_t>(&pool[i]);
        if ((elem_addr % 64) != 0) {
            return {"cache_line_alignment", false, "Contiguous vector SynapseState element misaligned."};
        }
    }

    return {"cache_line_alignment", true, "sizeof == 64, alignof == 64, and vector stride verified."};
}

// 2. Verify NaN, +/-Inf, and invalid domain inputs are rejected with zero state mutation
TestResult test_nan_inf_and_domain_rejection() {
    const double qnan = std::numeric_limits<double>::quiet_NaN();
    const double inf = std::numeric_limits<double>::infinity();
    const double ninf = -std::numeric_limits<double>::infinity();

    SynapseState s{};
    // Establish non-default timestamps and state first
    if (!s.apply_stdp(1.0, 2.0, 10.0) || !s.update_inhibitory_gain(2.5, 1.0, 0.48, 10.0)) {
        return {"nan_inf_rejection", false, "Failed to initialize baseline state before fault injection."};
    }
    const SynapseState snapshot = s;

    const double bad_values[] = {qnan, inf, ninf};
    for (double bad : bad_values) {
        if (s.apply_stdp(bad, 3.0, 10.0) ||
            s.apply_stdp(2.0, bad, 10.0) ||
            s.apply_stdp(2.0, 3.0, bad)) {
            return {"nan_inf_rejection", false, "apply_stdp accepted non-finite input."};
        }
        if (!state_exact_match(s, snapshot)) {
            return {"nan_inf_rejection", false, "apply_stdp mutated SynapseState on rejected non-finite input."};
        }

        if (s.update_inhibitory_gain(bad, 1.0, 0.48, 10.0) ||
            s.update_inhibitory_gain(3.0, bad, 0.48, 10.0) ||
            s.update_inhibitory_gain(3.0, 1.0, bad, 10.0) ||
            s.update_inhibitory_gain(3.0, 1.0, 0.48, bad) ||
            s.update_inhibitory_gain(3.0, 1.0, 0.48, 10.0, bad, 0.45, 0.12) ||
            s.update_inhibitory_gain(3.0, 1.0, 0.48, 10.0, 0.02, bad, 0.12) ||
            s.update_inhibitory_gain(3.0, 1.0, 0.48, 10.0, 0.02, 0.45, bad)) {
            return {"nan_inf_rejection", false, "update_inhibitory_gain accepted non-finite input."};
        }
        if (!state_exact_match(s, snapshot)) {
            return {"nan_inf_rejection", false, "update_inhibitory_gain mutated SynapseState on rejected non-finite input."};
        }
    }

    // Domain boundary violations (negative tau, out-of-range R, negative sigma)
    if (s.apply_stdp(2.0, 3.0, 0.0) ||
        s.apply_stdp(2.0, 3.0, -5.0) ||
        s.update_inhibitory_gain(3.0, -0.1, 0.48, 10.0) ||
        s.update_inhibitory_gain(3.0, 1.0, -0.01, 10.0) ||
        s.update_inhibitory_gain(3.0, 1.0, 1.01, 10.0) ||
        s.update_inhibitory_gain(3.0, 1.0, 0.48, 0.0) ||
        s.update_inhibitory_gain(3.0, 1.0, 0.48, 10.0, 0.0, 0.45, 0.12)) {
        return {"nan_inf_rejection", false, "Out-of-domain parameter was not rejected."};
    }
    if (!state_exact_match(s, snapshot)) {
        return {"nan_inf_rejection", false, "State mutated on out-of-domain parameter rejection."};
    }

    return {"nan_inf_rejection", true, "All NaN, +/-Inf, and invalid domain inputs rejected with zero state mutation."};
}

// 3. Verify STDP weight clamping [w_min, w_max], max_delta_w, and monotonic spike order
TestResult test_stdp_bounds_and_monotonicity() {
    SynapseState s{};
    s.max_delta_w = 0.005;

    // LTP step clamped by max_delta_w = 0.005 (raw_dw at dt=0 is 0.025)
    if (!s.apply_stdp(10.0, 10.0, 10.0)) {
        return {"stdp_bounds_and_monotonicity", false, "Valid coincident LTP spike rejected."};
    }
    if (!approx_equal(s.weight, 0.685 + 0.005)) {
        return {"stdp_bounds_and_monotonicity", false, "max_delta_w clamp failed on LTP update."};
    }

    // Out-of-order presynaptic and postsynaptic timestamps must fail cleanly
    if (s.apply_stdp(9.99, 10.1, 10.0) || s.apply_stdp(10.1, 9.99, 10.0)) {
        return {"stdp_bounds_and_monotonicity", false, "Non-monotonic spike timestamp accepted by apply_stdp."};
    }

    // Saturate upward to w_max = 1.0
    s.max_delta_w = 0.05;
    for (int i = 1; i <= 100; ++i) {
        const double t = 10.0 + static_cast<double>(i);
        if (!s.apply_stdp(t, t, 10.0)) {
            return {"stdp_bounds_and_monotonicity", false, "Monotonic LTP saturation step failed."};
        }
        if (s.weight > static_cast<double>(s.w_max) || s.weight < static_cast<double>(s.w_min)) {
            return {"stdp_bounds_and_monotonicity", false, "Weight escaped [w_min, w_max] during LTP."};
        }
    }
    if (!approx_equal(s.weight, static_cast<double>(s.w_max))) {
        return {"stdp_bounds_and_monotonicity", false, "Weight failed to clamp cleanly at w_max."};
    }

    // Saturate downward to w_min = 0.0 via LTD (post_ts < pre_ts while each stream stays monotonic)
    for (int i = 1; i <= 100; ++i) {
        const double post_t = 120.0 + static_cast<double>(i);
        const double pre_t = post_t + 0.5;
        if (!s.apply_stdp(pre_t, post_t, 10.0)) {
            return {"stdp_bounds_and_monotonicity", false, "Monotonic LTD saturation step failed."};
        }
        if (s.weight < static_cast<double>(s.w_min) || s.weight > static_cast<double>(s.w_max)) {
            return {"stdp_bounds_and_monotonicity", false, "Weight escaped [w_min, w_max] during LTD."};
        }
    }
    if (!approx_equal(s.weight, static_cast<double>(s.w_min))) {
        return {"stdp_bounds_and_monotonicity", false, "Weight failed to clamp cleanly at w_min."};
    }

    return {"stdp_bounds_and_monotonicity", true, "STDP max_delta_w, [w_min, w_max], and timestamp monotonicity verified."};
}

// 4. Verify sub-critical recovery (sigma < 1.0) and [kGMin, kGMax] gain clamping
TestResult test_subcritical_recovery_and_gain_bounds() {
    SynapseState s{};
    const double g_initial = s.g_inh; // 0.35

    // Pure sub-critical regime: sigma_branch = 0.40 < 1.0, order_param_r = 0.48 (zero phase error)
    // Expected first step:
    //   err_sigma = -0.60, kernel_decay = 1.0, err_r = 0.0
    //   subcritical_pull = -0.12 * 0.60 * (0.35 - 0.05) = -0.0216
    //   raw_dg = 0.02 * (-0.60) - 0.0216 = -0.0336 -> next_g = 0.3164
    if (!s.update_inhibitory_gain(1.0, 0.40, 0.48, 10.0)) {
        return {"subcritical_recovery", false, "Initial sub-critical update_inhibitory_gain call failed."};
    }
    if (!approx_equal(s.g_inh, 0.3164, 1e-9) || !(s.g_inh < g_initial)) {
        return {"subcritical_recovery", false, "Sub-critical pull failed to reduce g_inh by exact analytical delta."};
    }

    // Continued sub-critical recovery must asymptotically approach kGMin (0.05) without undershooting
    double prev_g = s.g_inh;
    for (int step = 2; step <= 120; ++step) {
        const double t = static_cast<double>(step);
        if (!s.update_inhibitory_gain(t, 0.25, 0.35, 10.0)) {
            return {"subcritical_recovery", false, "Sub-critical trajectory step rejected."};
        }
        const double delta = s.g_inh - prev_g;
        if (delta > 1e-12 || std::fabs(delta) > SynapseState::kMaxDeltaG + 1e-12) {
            return {"subcritical_recovery", false, "Sub-critical g_inh failed monotonic decay or violated kMaxDeltaG."};
        }
        if (s.g_inh < SynapseState::kGMin) {
            return {"subcritical_recovery", false, "g_inh undershot kGMin (0.05) during sub-critical recovery."};
        }
        prev_g = s.g_inh;
    }
    if (!approx_equal(s.g_inh, SynapseState::kGMin, 1e-6)) {
        return {"subcritical_recovery", false, "g_inh failed to converge to kGMin floor under sustained sub-criticality."};
    }

    // Super-critical regime (sigma = 1.80, R = 0.90) must drive g_inh up to kGMax (2.00)
    for (int step = 121; step <= 260; ++step) {
        const double t = static_cast<double>(step);
        if (!s.update_inhibitory_gain(t, 1.80, 0.90, 10.0)) {
            return {"subcritical_recovery", false, "Super-critical trajectory step rejected."};
        }
        const double delta = s.g_inh - prev_g;
        if (delta < -1e-12 || delta > SynapseState::kMaxDeltaG + 1e-12) {
            return {"subcritical_recovery", false, "Super-critical g_inh violated monotonic rise or kMaxDeltaG."};
        }
        if (s.g_inh > SynapseState::kGMax) {
            return {"subcritical_recovery", false, "g_inh exceeded kGMax (2.00)."};
        }
        prev_g = s.g_inh;
    }
    if (!approx_equal(s.g_inh, SynapseState::kGMax, 1e-6)) {
        return {"subcritical_recovery", false, "g_inh failed to clamp at kGMax ceiling under sustained super-criticality."};
    }

    return {"subcritical_recovery", true, "Sub-critical recovery pull and [kGMin, kGMax] clamps verified."};
}

// 5. Verify zero last_post_ts aliasing when update_inhibitory_gain precedes apply_stdp
TestResult test_zero_last_post_ts_aliasing() {
    SynapseState s{};

    // Inhibitory spike arrives at t = 10.5 ms BEFORE delayed excitatory post_ts = 10.0 ms
    if (!s.update_inhibitory_gain(10.5, 0.95, 0.46, 10.0)) {
        return {"zero_last_post_ts_aliasing", false, "Leading inhibitory update failed."};
    }
    if (!approx_equal(s.last_inh_ts, 10.5) || !approx_equal(s.last_post_ts, -1.0)) {
        return {"zero_last_post_ts_aliasing", false, "update_inhibitory_gain mutated last_post_ts instead of last_inh_ts."};
    }

    if (!s.apply_stdp(9.2, 10.0, 10.0)) {
        return {"zero_last_post_ts_aliasing", false, "apply_stdp was falsely rejected due to last_post_ts aliasing."};
    }
    if (!approx_equal(s.last_post_ts, 10.0) || !approx_equal(s.last_inh_ts, 10.5)) {
        return {"zero_last_post_ts_aliasing", false, "apply_stdp overwrote last_inh_ts."};
    }

    // Stress-test 500 interleaved steps where inhibitory gain always leads post_ts by +0.35 ms
    int dropped_stdp = 0;
    int dropped_inh = 0;
    for (int step = 1; step <= 500; ++step) {
        const double base_t = 20.0 + static_cast<double>(step);
        if (!s.update_inhibitory_gain(base_t + 0.35, 0.98, 0.47, 10.0)) {
            ++dropped_inh;
        }
        if (!s.apply_stdp(base_t - 0.15, base_t, 10.0)) {
            ++dropped_stdp;
        }
    }

    if (dropped_stdp != 0 || dropped_inh != 0) {
        return {"zero_last_post_ts_aliasing", false, "Interleaved spike stream suffered aliasing drops."};
    }

    // Confirm independent monotonic enforcement still rejects genuine regressions on each stream
    if (s.update_inhibitory_gain(520.10, 1.0, 0.48, 10.0)) {
        return {"zero_last_post_ts_aliasing", false, "Out-of-order inhibitory timestamp was not rejected."};
    }
    if (!s.apply_stdp(520.20, 520.30, 10.0)) {
        return {"zero_last_post_ts_aliasing", false, "Valid monotonic post_ts failed after rejected inhibitory spike."};
    }

    return {"zero_last_post_ts_aliasing", true, "500/500 interleaved updates succeeded with 0% aliasing drops."};
}

} // namespace

int main(int argc, char** argv) {
    bool json_mode = false;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--json") {
            json_mode = true;
        }
    }

    const std::vector<TestResult> results = {
        test_cache_line_alignment(),
        test_nan_inf_and_domain_rejection(),
        test_stdp_bounds_and_monotonicity(),
        test_subcritical_recovery_and_gain_bounds(),
        test_zero_last_post_ts_aliasing(),
    };

    int passed_count = 0;
    for (const auto& r : results) {
        if (r.passed) {
            ++passed_count;
        }
    }
    const bool all_passed = (passed_count == static_cast<int>(results.size()));

    if (json_mode) {
        std::cout << "{\"passed\": " << (all_passed ? "true" : "false")
                  << ", \"total\": " << results.size()
                  << ", \"passed_count\": " << passed_count
                  << ", \"sizeof_synapse_state\": " << sizeof(SynapseState)
                  << ", \"alignof_synapse_state\": " << alignof(SynapseState)
                  << ", \"tests\": [";
        for (std::size_t i = 0; i < results.size(); ++i) {
            if (i > 0) std::cout << ", ";
            std::cout << "{\"name\": \"" << results[i].name
                      << "\", \"passed\": " << (results[i].passed ? "true" : "false")
                      << ", \"detail\": \"" << results[i].detail << "\"}";
        }
        std::cout << "]}\n";
    } else {
        for (const auto& r : results) {
            std::cout << (r.passed ? "[PASS] " : "[FAIL] ")
                      << r.name << " — " << r.detail << "\n";
        }
        std::cout << "Summary: " << passed_count << "/" << results.size() << " tests passed.\n";
    }

    return all_passed ? 0 : 1;
}
