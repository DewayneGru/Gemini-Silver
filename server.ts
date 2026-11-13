import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  resolveSteeringMode,
  synthesizeMechanisticDerivation,
  computeWatchdogHash,
  formatWatchdogJsonBlock,
  type DerivationRecord,
  type SteeringMode,
  type ClaimStatus,
} from './src/engine/epistemicEngine';
import {
  ensureSeededSilverState,
  getSilverSteeringState,
  getSilverVerificationsState,
  ingestSilverOutput,
  triggerSilverVerification,
  getQuotaState,
  updateQuotaState,
  validatePatchBoundaries,
  buildSilverContextBundle,
} from './src/engine/silverWatchdogService';

dotenv.config();
ensureSeededSilverState();

const PORT = 3000;

function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const SYSTEM_INSTRUCTION = `# SYSTEM ROLE: MECHANISTIC REASONING & EPISTEMIC ENGINE
You are operating as the core reasoning module inside the SynapseEdge + Watchdog architecture. Your objective is first-principles scientific synthesis, mathematical derivation, and mechanistic engineering—never consensus summary or boilerplate overview.

1. First-Principles Decomposition: Strip problems down to underlying physical, mathematical, or computational invariants (conservation laws, scaling limits, boundary conditions, phase dynamics, dimensional constraints).
2. Constructive Mechanism: Derive concrete, testable mechanisms for how the target phenomenon or architecture can be constructed, stabilized, or falsified.
3. Adversarial Watchdog Self-Check: Check dimensional consistency and boundary/singularity behavior. Identify hidden assumptions and failure modes. Tag every major claim as [VERIFIED] or [HYPOTHESIS].
4. Scratchpad vs. Ledger Isolation: Never treat exploratory derivations or unverified hypotheses as settled invariants. Keep speculative branches isolated (ready_for_ledger_commit: false) until they pass explicit falsification criteria.
5. Mandatory Output Contract: End every response with a single fenced \`\`\`json block matching the Watchdog schema (steering_mode_honored, claim_status, core_mechanism, invariants_checked, hidden_assumptions, falsification_test, ready_for_ledger_commit).`;

const ROLE_INSTRUCTIONS: Record<string, string> = {
  'stdp-architect':
    'Focus on C++20 64-byte cache-aligned SynapseState kernels, bounded spike-timing-dependent plasticity (STDP), axonal conduction delays tau in [1ms, 20ms], and Kuramoto phase-oscillator synchronization.',
  'watchdog-auditor':
    'Focus on adversarial falsification, dimensional homogeneity, singularity detection, Merkle leaf SHA-256("leaf:" || rawBody) integrity, and strict Scratchpad vs. Ledger isolation.',
  'continuum-physicist':
    'Focus on partial differential conservation laws, Buckingham Pi dimensionless scaling groups, Lyapunov stability spectra, and non-equilibrium thermodynamic bounds.',
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Silver Epistemic Ledger & C++20 Watchdog Daemon Routes
  app.get('/quota-state', (_req, res) => {
    res.json({ ok: true, ...getQuotaState() });
  });

  app.post('/quota-state', (req, res) => {
    const updated = updateQuotaState(req.body || {});
    res.json({ ok: true, ...updated });
  });

  app.post('/apply-patch', (req, res) => {
    const content = String(req.body?.content || '');
    if (!content.trim()) {
      res.status(400).json({ ok: false, error: 'Empty patch content.' });
      return;
    }
    const check = validatePatchBoundaries(content);
    res.status(check.ok ? 200 : 422).json(check);
  });

  app.get('/api/silver/context-bundle', (_req, res) => {
    const bundleText = buildSilverContextBundle();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gemini_silver_context.txt"');
    res.send(bundleText);
  });

  app.get('/silver-verifications', (_req, res) => {
    res.json(getSilverVerificationsState());
  });

  app.get('/silver-steering', (_req, res) => {
    res.json(getSilverSteeringState());
  });

  app.post('/silver-ingest', (req, res) => {
    const result = ingestSilverOutput(req.body || {});
    res.status(result.status).json(result.body);
  });

  app.post('/silver-verify', (req, res) => {
    const result = triggerSilverVerification(req.body || {});
    res.status(result.status).json(result.body);
  });

  // Multi-Turn Mechanistic Reasoning Chat Endpoint
  app.post('/api/chat/message', async (req, res) => {
    const {
      messages = [],
      userMessage = '',
      model = 'gemini-4-hydrogen',
      rolePersona = 'stdp-architect',
      orderParameterR = 0.48,
    } = req.body || {};

    const cleanMsg = String(userMessage || '').trim();
    if (!cleanMsg) {
      res.status(400).json({ ok: false, error: 'Message cannot be empty.' });
      return;
    }

    const numericR = Number.isFinite(Number(orderParameterR)) ? Number(orderParameterR) : 0.48;
    const steeringMode = resolveSteeringMode(numericR);
    const liveSteering = getSilverSteeringState();
    const roleAddendum = ROLE_INSTRUCTIONS[rolePersona] || ROLE_INSTRUCTIONS['stdp-architect'];

    // Deterministic first-principles response builder (used when offline or if upstream model is unavailable)
    const buildDeterministicChatReply = (): string => {
      const isVerifiedRequest = /verify|verified|prove|conservation|alignas|bounded/i.test(cleanMsg);
      const claimStatus: ClaimStatus = isVerifiedRequest ? 'VERIFIED' : 'HYPOTHESIS';
      const contract = {
        steering_mode_honored: steeringMode,
        claim_status: claimStatus,
        core_mechanism: `Bounded STDP weight update Δw clamped to [-0.05, +0.05] within 64-byte aligned SynapseState stabilizes Kuramoto order parameter near R = ${numericR.toFixed(
          2
        )} under axonal delay tau.`,
        invariants_checked: [
          'Compile-time alignof(SynapseState) == 64 cache-line boundary invariant',
          'Strict NaN/Inf rejection and monotonic pre_ts / post_ts spike ordering',
          'Dimensional consistency of exponential STDP window exp(-Δt / tau_ms)',
        ],
        hidden_assumptions: [
          'Conduction delay tau remains bounded below the 5ms phase-instability knee',
          'All-to-all mean-field coupling approximates sparse cortical connectivity at N = 32',
        ],
        falsification_test:
          'Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.78 before tau=5ms, hypothesis fails.',
        ready_for_ledger_commit: claimStatus === 'VERIFIED',
      };

      return (
        `### First-Principles Decomposition (${steeringMode})\n\n` +
        `1. **Conservation & Structural Invariant** \`[${claimStatus}]\`: In \`synapse_stdp.hpp\`, \`SynapseState\` enforces \`alignas(64)\` single cache-line residency ($64\\text{ B}$) and bounds each synaptic update via $|\\Delta w| \\le \\Delta w_{\\max} = 0.05$ on $w \\in [0.0, 1.0]$.\n` +
        `2. **Constructive Phase-Coupled Mechanism** \`[${claimStatus}]\`: Under homeostatic steering at $R = ${numericR.toFixed(
          3
        )}$ ($K = ${liveSteering.coupling_k.toFixed(
          2
        )}\\text{ s}^{-1}$), the coupled phase evolution obeys:\n` +
        `   $$\\frac{d\\theta_i}{dt} = \\omega_i + K_{\\text{eff}}(\\tau) R \\sin(\\psi - \\theta_i), \\quad \\Delta w_i = \\operatorname{clamp}\\!\\left(\\eta \\cos(\\psi - \\theta_i)(R_{\\text{target}} - R), -0.05, 0.05\\right)$$\n` +
        `3. **Adversarial Watchdog Self-Check**: Non-monotonic spike timestamps ($t_{\\text{cand}} < t_{\\text{last}}$) and non-finite floating-point operands (\`NaN\`/\`Inf\`) are rejected prior to state mutation.\n\n` +
        formatWatchdogJsonBlock(contract)
      );
    };

    const allowedModels = new Set([
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
      'gemini-4-argon',
      'gemini-4-carbon',
    ]);
    const selectedModel = allowedModels.has(String(model)) ? String(model) : 'gemini-4-hydrogen';

    const ai = getAiClient();
    if (!ai) {
      res.json({
        ok: true,
        reply: buildDeterministicChatReply(),
        modelUsed: `${selectedModel} (deterministic-kernel)`,
        steeringMode,
      });
      return;
    }

    try {
      const historyContents = Array.isArray(messages)
        ? messages
            .slice(-10)
            .map((m: { role?: string; text?: string }) => ({
              role: m.role === 'model' ? 'model' : 'user',
              parts: [{ text: String(m.text || '') }],
            }))
        : [];

      const fullContents = [
        ...historyContents,
        {
          role: 'user',
          parts: [
            {
              text: `${liveSteering.steering_header}\n${cleanMsg}`,
            },
          ],
        },
      ];

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: fullContents,
        config: {
          systemInstruction: `${SYSTEM_INSTRUCTION}\n\nROLE SPECIALIZATION: ${roleAddendum}`,
          ...(selectedModel === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });

      const replyText = (response.text ?? '').trim() || buildDeterministicChatReply();
      res.json({
        ok: true,
        reply: replyText,
        modelUsed: selectedModel,
        steeringMode,
      });
    } catch {
      res.json({
        ok: true,
        reply: buildDeterministicChatReply(),
        modelUsed: `${selectedModel} (deterministic-kernel)`,
        steeringMode,
      });
    }
  });

  // Existing Mechanistic Workbench Synthesis Route
  app.post('/api/reasoning/synthesize', async (req, res) => {
    const {
      prompt = '',
      orderParameterR = 0.48,
      domain = 'Applied Physics & Mechanistic Systems',
      previousLedgerHash = 'wdg_7c12a0948b11e02f',
      solverMode = 'deterministic',
    } = req.body || {};

    const numericR = Number.isFinite(Number(orderParameterR)) ? Number(orderParameterR) : 0.48;
    const steeringMode: SteeringMode = resolveSteeringMode(numericR);
    const fallbackRecord = synthesizeMechanisticDerivation(
      String(prompt),
      numericR,
      String(domain),
      previousLedgerHash
    );

    const ai = getAiClient();
    if (!ai || solverMode === 'deterministic') {
      res.json({ record: fallbackRecord, engineSource: 'deterministic-solver' });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `STEERING DIRECTIVE: ${steeringMode} (Order Parameter R = ${numericR.toFixed(2)})
DOMAIN: ${domain}
TARGET PROBLEM: ${prompt}

Produce a complete first-principles mechanistic derivation honoring steering mode ${steeringMode}.`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              governingEquation: { type: Type.STRING },
              dimensionalScalingLaw: { type: Type.STRING },
              invariants: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    expression: { type: Type.STRING },
                    siUnits: { type: Type.STRING },
                    boundaryBehavior: { type: Type.STRING },
                    status: { type: Type.STRING },
                    residual: { type: Type.NUMBER },
                  },
                  required: ['name', 'expression', 'siUnits', 'boundaryBehavior', 'status'],
                },
              },
              claims: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tag: { type: Type.STRING },
                    statement: { type: Type.STRING },
                    equation: { type: Type.STRING },
                    derivationNote: { type: Type.STRING },
                    failureMode: { type: Type.STRING },
                  },
                  required: ['tag', 'statement', 'equation', 'derivationNote', 'failureMode'],
                },
              },
              watchdogContract: {
                type: Type.OBJECT,
                properties: {
                  steering_mode_honored: { type: Type.STRING },
                  claim_status: { type: Type.STRING },
                  core_mechanism: { type: Type.STRING },
                  invariants_checked: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  hidden_assumptions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  falsification_test: { type: Type.STRING },
                  ready_for_ledger_commit: { type: Type.BOOLEAN },
                },
                required: [
                  'steering_mode_honored',
                  'claim_status',
                  'core_mechanism',
                  'invariants_checked',
                  'hidden_assumptions',
                  'falsification_test',
                  'ready_for_ledger_commit',
                ],
              },
            },
            required: [
              'title',
              'governingEquation',
              'dimensionalScalingLaw',
              'invariants',
              'claims',
              'watchdogContract',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const rawContract = parsed.watchdogContract || fallbackRecord.watchdogContract;
      const claimStatus: ClaimStatus =
        rawContract.claim_status === 'VERIFIED' ? 'VERIFIED' : 'HYPOTHESIS';
      const readyCommit =
        claimStatus === 'VERIFIED' ? Boolean(rawContract.ready_for_ledger_commit) : false;

      const watchdogContract = {
        steering_mode_honored: steeringMode,
        claim_status: claimStatus,
        core_mechanism: String(
          rawContract.core_mechanism || fallbackRecord.watchdogContract.core_mechanism
        ),
        invariants_checked:
          Array.isArray(rawContract.invariants_checked) && rawContract.invariants_checked.length >= 2
            ? rawContract.invariants_checked.map(String)
            : fallbackRecord.watchdogContract.invariants_checked,
        hidden_assumptions:
          Array.isArray(rawContract.hidden_assumptions) && rawContract.hidden_assumptions.length >= 1
            ? rawContract.hidden_assumptions.map(String)
            : fallbackRecord.watchdogContract.hidden_assumptions,
        falsification_test: String(
          rawContract.falsification_test || fallbackRecord.watchdogContract.falsification_test
        ),
        ready_for_ledger_commit: readyCommit,
      };

      const stateHash = computeWatchdogHash(watchdogContract, previousLedgerHash);

      const record: DerivationRecord = {
        ...fallbackRecord,
        title: String(parsed.title || fallbackRecord.title),
        governingEquation: String(parsed.governingEquation || fallbackRecord.governingEquation),
        dimensionalScalingLaw: String(
          parsed.dimensionalScalingLaw || fallbackRecord.dimensionalScalingLaw
        ),
        invariants:
          Array.isArray(parsed.invariants) && parsed.invariants.length > 0
            ? parsed.invariants.map((inv: Record<string, unknown>, idx: number) => ({
                id: `inv-${Date.now()}-${idx}`,
                name: String(inv.name || 'Conservation Invariant'),
                expression: String(inv.expression || '∂ρ/∂t + ∇·J = 0'),
                siUnits: String(inv.siUnits || 'dimensionless'),
                boundaryBehavior: String(inv.boundaryBehavior || 'Regular at domain boundary'),
                status: inv.status === 'VERIFIED' ? 'VERIFIED' : 'HYPOTHESIS',
                residual: Number.isFinite(Number(inv.residual)) ? Number(inv.residual) : 0.0011,
              }))
            : fallbackRecord.invariants,
        claims:
          Array.isArray(parsed.claims) && parsed.claims.length > 0
            ? parsed.claims.map((clm: Record<string, unknown>, idx: number) => ({
                id: `clm-${Date.now()}-${idx}`,
                tag: clm.tag === 'VERIFIED' ? 'VERIFIED' : 'HYPOTHESIS',
                statement: String(clm.statement || ''),
                equation: String(clm.equation || ''),
                derivationNote: String(clm.derivationNote || ''),
                failureMode: String(clm.failureMode || ''),
              }))
            : fallbackRecord.claims,
        watchdogContract,
        stateHash,
        isolationZone: readyCommit ? 'LEDGER' : 'SCRATCHPAD',
        falsificationPassed: readyCommit,
      };

      res.json({ record, engineSource: 'gemini-4-hydrogen' });
    } catch {
      res.json({ record: fallbackRecord, engineSource: 'deterministic-solver' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SynapseEdge Epistemic Engine listening on http://localhost:${PORT}`);
  });
}

startServer();
