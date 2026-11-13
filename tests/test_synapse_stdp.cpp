#include <cmath>
#include <iostream>
#include <limits>
#include <string>

#include "../synapse_stdp.hpp"

int main(int argc, char** argv) {
    bool json_mode = false;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--json") {
            json_mode = true;
        }
    }

    SynapseState state{};
    const bool align_ok = (alignof(SynapseState) == 64);

    // 1. Valid monotonic STDP step
    const bool step1_ok = state.apply_stdp(10.0, 12.5, 10.0);

    // 2. Reject NaN / Inf inputs
    const double qnan = std::numeric_limits<double>::quiet_NaN();
    const double pinf = std::numeric_limits<double>::infinity();
    const bool nan_rejected = !state.apply_stdp(qnan, 15.0, 10.0) && !state.apply_stdp(15.0, pinf, 10.0);

    // 3. Reject non-monotonic out-of-order timestamp (9.0 < 10.0)
    const bool out_of_order_rejected = !state.apply_stdp(9.0, 13.0, 10.0);

    // 4. Verify [w_min, w_max] and max_delta_w clamping over 100 potentiation steps
    bool bounds_ok = true;
    double ts = 20.0;
    for (int i = 0; i < 100; ++i) {
        double prev_w = state.weight;
        if (!state.apply_stdp(ts, ts + 0.5, 10.0)) {
            bounds_ok = false;
            break;
        }
        if (std::abs(state.weight - prev_w) > state.max_delta_w + 1e-9 ||
            state.weight < state.w_min || state.weight > state.w_max) {
            bounds_ok = false;
            break;
        }
        ts += 1.0;
    }

    const bool all_passed = align_ok && step1_ok && nan_rejected && out_of_order_rejected && bounds_ok;

    if (json_mode) {
        std::cout << "{\"passed\":" << (all_passed ? "true" : "false")
                  << ",\"alignment_64\":" << (align_ok ? "true" : "false")
                  << ",\"nan_rejected\":" << (nan_rejected ? "true" : "false")
                  << ",\"out_of_order_rejected\":" << (out_of_order_rejected ? "true" : "false")
                  << ",\"bounds_ok\":" << (bounds_ok ? "true" : "false")
                  << ",\"final_weight\":" << state.weight << "}\n";
    } else {
        std::cout << "test_synapse_stdp: " << (all_passed ? "PASS" : "FAIL") << "\n";
    }

    return all_passed ? 0 : 1;
}
