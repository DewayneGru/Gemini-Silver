import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSteeringMode,
  validateWatchdogContract,
  formatWatchdogJsonBlock,
  extractWatchdogJsonBlock,
  computeKuramotoTrajectory,
  synthesizeMechanisticDerivation,
  runFalsificationVerificationPass,
  SEED_DERIVATIONS,
} from './epistemicEngine';
import {
  signSilverEnvelope,
  verifySilverLedgerRecord,
  parseFalsificationTest,
  runBoundedStdpSweep,
  evaluateFalsificationSpec,
  validatePatchBoundaries,
  buildSilverContextBundle,
} from './silverWatchdogService';

test('resolveSteeringMode maps Kuramoto order parameter R around critical point R_c = 0.48', () => {
  assert.equal(resolveSteeringMode(0.48), 'CRITICAL_BALANCE');
  assert.equal(resolveSteeringMode(0.49), 'CRITICAL_BALANCE');
  assert.equal(resolveSteeringMode(0.46), 'CRITICAL_BALANCE');
  assert.equal(resolveSteeringMode(0.68), 'DIVERGE_EXPLORE');
  assert.equal(resolveSteeringMode(0.25), 'CONVERGE_SYNTHESIZE');
});

test('validateWatchdogContract enforces Scratchpad vs. Ledger Isolation on HYPOTHESIS claims', () => {
  const scratchpadSeed = SEED_DERIVATIONS[0];
  const auditValidScratchpad = validateWatchdogContract(
    scratchpadSeed.watchdogContract,
    'CRITICAL_BALANCE'
  );
  assert.equal(auditValidScratchpad.valid, true);
  assert.equal(auditValidScratchpad.isolationCompliant, true);

  const illegalContract = {
    ...scratchpadSeed.watchdogContract,
    claim_status: 'HYPOTHESIS' as const,
    ready_for_ledger_commit: true,
  };
  const auditIllegal = validateWatchdogContract(illegalContract, 'CRITICAL_BALANCE');
  assert.equal(auditIllegal.valid, false);
  assert.equal(auditIllegal.isolationCompliant, false);
  assert.ok(auditIllegal.violations.some((v) => v.includes('Scratchpad Isolation Violation')));
});

test('formatWatchdogJsonBlock and extractWatchdogJsonBlock round-trip the Mandatory Output Contract', () => {
  const contract = SEED_DERIVATIONS[1].watchdogContract;
  const fenced = `Here is the derivation.\n\n${formatWatchdogJsonBlock(contract)}`;
  const extracted = extractWatchdogJsonBlock(fenced);
  assert.ok(extracted);
  assert.equal(extracted.steering_mode_honored, 'CONVERGE_SYNTHESIZE');
  assert.equal(extracted.claim_status, 'VERIFIED');
  assert.equal(extracted.ready_for_ledger_commit, true);
  assert.equal(extracted.invariants_checked.length, 3);
});

test('computeKuramotoTrajectory produces deterministic phase-space time-series with peak susceptibility near R = 0.48', () => {
  const criticalTraj = computeKuramotoTrajectory(0.48, 2.15, 0.14, 24);
  const offCriticalTraj = computeKuramotoTrajectory(0.90, 2.15, 0.14, 24);
  assert.equal(criticalTraj.length, 24);
  const lastCritical = criticalTraj[criticalTraj.length - 1];
  const lastOffCritical = offCriticalTraj[offCriticalTraj.length - 1];
  assert.ok(lastCritical.susceptibility > lastOffCritical.susceptibility);
});

test('synthesizeMechanisticDerivation and runFalsificationVerificationPass transition HYPOTHESIS from SCRATCHPAD to LEDGER readiness', () => {
  const draft = synthesizeMechanisticDerivation(
    'Stabilize magnetohydrodynamic Rayleigh-Taylor instability at ablative fusion interface',
    0.48,
    'Inertial Fusion Physics'
  );
  assert.equal(draft.steeringMode, 'CRITICAL_BALANCE');
  assert.equal(draft.isolationZone, 'SCRATCHPAD');
  assert.equal(draft.watchdogContract.claim_status, 'HYPOTHESIS');
  assert.equal(draft.watchdogContract.ready_for_ledger_commit, false);

  const verified = runFalsificationVerificationPass(draft, 'wdg_7c12a0948b11e02f');
  assert.equal(verified.falsificationPassed, true);
  assert.equal(verified.watchdogContract.claim_status, 'VERIFIED');
  assert.equal(verified.watchdogContract.ready_for_ledger_commit, true);
});

test('signSilverEnvelope and verifySilverLedgerRecord verify SHA-256("leaf:" || rawBody) and detect tampering', () => {
  const key = Buffer.from('unit-test-hmac-secret', 'utf-8');
  const envelope = {
    prompt_id: 'test-stdp-01',
    timestamp_ms: 1700000000000,
    committed: true,
    quarantine_reason: null,
  };
  const { merkleLeaf, hmacSha256 } = signSilverEnvelope(envelope, key);
  const validCheck = verifySilverLedgerRecord(
    { envelope, merkle_leaf: merkleLeaf, hmac_sha256: hmacSha256 },
    key
  );
  assert.equal(validCheck.valid, true);

  // Tamper with envelope
  const tamperedCheck = verifySilverLedgerRecord(
    {
      envelope: { ...envelope, committed: false },
      merkle_leaf: merkleLeaf,
      hmac_sha256: hmacSha256,
    },
    key
  );
  assert.equal(tamperedCheck.valid, false);
  assert.match(tamperedCheck.reason, /Merkle leaf hash mismatch/);
});

test('parseFalsificationTest and evaluateFalsificationSpec accurately flag falsified STDP sweeps', () => {
  const passingSpec = parseFalsificationTest(
    'Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.85 before tau=5ms, hypothesis fails.'
  );
  assert.equal(passingSpec.param_name, 'tau');
  assert.equal(passingSpec.start_val, 1.0);
  assert.equal(passingSpec.end_val, 20.0);
  assert.equal(passingSpec.threshold_val, 0.85);
  assert.equal(passingSpec.cutoff_val, 5.0);

  const sweepOut = runBoundedStdpSweep(passingSpec);
  const passEval = evaluateFalsificationSpec(passingSpec, sweepOut, true);
  assert.equal(passEval.passed, true);

  const failingSpec = parseFalsificationTest(
    'Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.50 before tau=18ms, hypothesis fails.'
  );
  const failEval = evaluateFalsificationSpec(failingSpec, sweepOut, true);
  assert.equal(failEval.passed, false);
  assert.match(failEval.failureReason || '', /Falsified at tau=/);
});

test('validatePatchBoundaries blocks protected paths and buildSilverContextBundle packs all 5 core files', () => {
  const blockedPatch = validatePatchBoundaries(
    '--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-SYNAPSE_HMAC_KEY=old\n+SYNAPSE_HMAC_KEY=new\n'
  );
  assert.equal(blockedPatch.ok, false);
  assert.match(blockedPatch.error || '', /Blocked protected or invalid path/);

  const validPatch = validatePatchBoundaries(
    '--- a/synapse_stdp.hpp\n+++ b/synapse_stdp.hpp\n@@ -1 +1 @@\n-// comment\n+// updated\n'
  );
  assert.equal(validPatch.ok, true);

  const bundle = buildSilverContextBundle();
  assert.ok(bundle.includes('FILE: GEMINI_SILVER_SYSTEM_PROMPT.md'));
  assert.ok(bundle.includes('FILE: synapse_edge_watchdog.py'));
  assert.ok(bundle.includes('FILE: synapse_stdp.hpp'));
  assert.ok(bundle.includes('FILE: tests/test_synapse_stdp.cpp'));
  assert.ok(bundle.includes('FILE: scripts/verify_silver_ledger.py'));
});
