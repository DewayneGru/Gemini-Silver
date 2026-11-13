import React, { useState, useRef, useEffect } from 'react';
import { Send, ArrowUpRight, RotateCcw, MessageSquare } from 'lucide-react';
import type { SteeringMode } from '../engine/epistemicEngine';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelUsed?: string;
  steeringMode?: string;
}

interface MechanisticChatPanelProps {
  orderParameterR: number;
  steeringMode: SteeringMode;
  onIngestChatResponse: (promptId: string, rawOutput: string) => void;
}

const MODEL_TIERS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'General Mechanistic (gemini-4-hydrogen)',
    taskDesc: 'Balanced mathematical derivation & conservation synthesis',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Fast Telemetry (gemini-3.1-flash-lite)',
    taskDesc: 'Low-latency dimensional & parameter checks',
  },
  {
    id: 'gemini-4-argon',
    label: 'Complex Interactive (gemini-4-argon)',
    taskDesc: 'Multi-step coupled PDE & C++20 STDP kernel architecture',
  },
  {
    id: 'gemini-4-carbon',
    label: 'Deep Proof Audit (gemini-4-carbon)',
    taskDesc: 'Deep formal falsification & singularity boundary proofs',
  },
];

const PERSONA_ROLES = [
  {
    id: 'stdp-architect',
    label: 'C++20 STDP & Kuramoto Kernel Architect',
  },
  {
    id: 'watchdog-auditor',
    label: 'Adversarial Watchdog & Merkle/HMAC Auditor',
  },
  {
    id: 'continuum-physicist',
    label: 'First-Principles Continuum & Plasma Physicist',
  },
];

const INITIAL_MESSAGES: ChatTurn[] = [
  {
    id: 'msg-seed-1',
    role: 'model',
    timestamp: '17:55:00',
    modelUsed: 'gemini-4-hydrogen',
    steeringMode: 'CRITICAL_BALANCE',
    text: `### Mechanistic Reasoning & Epistemic Engine Ready [VERIFIED]
Operating under the **SynapseEdge + Watchdog** contract. Specify a C++20 \`synapse_stdp.hpp\` kernel constraint, Kuramoto phase-coupling problem, or continuum stability hypothesis. Every derivation includes a trailing \`\`\`json telemetry block ready for one-click ingestion into the cryptographic Merkle/HMAC ledger.

\`\`\`json
{
  "steering_mode_honored": "CRITICAL_BALANCE",
  "claim_status": "VERIFIED",
  "core_mechanism": "64-byte aligned SynapseState enforces bounded STDP plasticity |delta_w| <= 0.05 and monotonic spike arrival guards around R_target = 0.48.",
  "invariants_checked": [
    "Compile-time alignof(SynapseState) == 64 cache-line boundary invariant",
    "Strict NaN/Inf rejection and monotonic pre/post spike timestamp ordering"
  ],
  "hidden_assumptions": [
    "Axonal transmission delay tau remains bounded within [1ms, 20ms]"
  ],
  "falsification_test": "Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.85 before tau=5ms, hypothesis fails.",
  "ready_for_ledger_commit": true
}
\`\`\``,
  },
];

export const MechanisticChatPanel: React.FC<MechanisticChatPanelProps> = ({
  orderParameterR,
  steeringMode,
  onIngestChatResponse,
}) => {
  const [messages, setMessages] = useState<ChatTurn[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-4-hydrogen');
  const [selectedPersona, setSelectedPersona] = useState<string>('stdp-architect');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [ingestedIds, setIngestedIds] = useState<Record<string, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    const nextHistory = [...messages, userTurn];
    setMessages(nextHistory);
    setInput('');
    setIsSending(true);

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          userMessage: trimmed,
          model: selectedModel,
          rolePersona: selectedPersona,
          orderParameterR,
        }),
      });

      const data = await res.json();
      const assistantTurn: ChatTurn = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: String(data.reply || 'Derivation failed to return text.'),
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        modelUsed: String(data.modelUsed || selectedModel),
        steeringMode: String(data.steeringMode || steeringMode),
      };
      setMessages((prev) => [...prev, assistantTurn]);
    } catch {
      const fallbackTurn: ChatTurn = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: 'Unable to reach reasoning endpoint.',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
      setMessages((prev) => [...prev, fallbackTurn]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section
      aria-label="Multi-Turn Mechanistic Reasoning Chat"
      className="bg-white border border-slate-200 p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-base font-semibold text-slate-900">
              06. Interactive Multi-Turn Mechanistic Reasoning Dialogue
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            <span>Steering Context: {steeringMode}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>R = {orderParameterR.toFixed(2)}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Auto-Attaches [SYNAPSE_EDGE_STEERING] Header</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMessages(INITIAL_MESSAGES)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Thread</span>
        </button>
      </div>

      {/* Role Persona & Model Selector Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="chat-persona-select"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            System Role Directive
          </label>
          <select
            id="chat-persona-select"
            value={selectedPersona}
            onChange={(e) => setSelectedPersona(e.target.value)}
            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {PERSONA_ROLES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="chat-model-select"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Reasoning Model Tier
          </label>
          <select
            id="chat-model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {MODEL_TIERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scrollable Multi-Turn Conversation Thread */}
      <div
        ref={scrollContainerRef}
        data-testid="mechanistic-chat-thread"
        className="max-h-96 overflow-y-auto border border-slate-200 bg-slate-50 p-4 space-y-4"
      >
        {messages.map((turn) => {
          const isUser = turn.role === 'user';
          const hasJson = /```json\s*[\s\S]*?\s*```/.test(turn.text);
          const alreadyIngested = Boolean(ingestedIds[turn.id]);

          return (
            <article
              key={turn.id}
              className={`p-4 border ${
                isUser
                  ? 'bg-slate-900 text-white border-slate-900 ml-8'
                  : 'bg-white text-slate-900 border-slate-200 mr-4'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/60 text-[11px] font-mono tabular-nums">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {isUser ? 'RESEARCHER PROMPT' : 'EPISTEMIC ENGINE DERIVATION'}
                  </span>
                  {turn.modelUsed && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={isUser ? 'text-slate-300' : 'text-slate-500'}>
                        {turn.modelUsed}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className={isUser ? 'text-slate-300' : 'text-slate-400'}>
                    {turn.timestamp}
                  </span>
                  {!isUser && hasJson && (
                    <button
                      type="button"
                      onClick={() => {
                        setIngestedIds((prev) => ({ ...prev, [turn.id]: true }));
                        onIngestChatResponse(`chat-${turn.id}`, turn.text);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>
                        {alreadyIngested ? 'Routed to Silver Ledger' : 'Ingest to Silver Ledger'}
                      </span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed overflow-x-auto">
                {turn.text}
              </pre>
            </article>
          );
        })}
      </div>

      {/* Chat Input Form */}
      <form onSubmit={handleSendMessage} className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          aria-label="Ask the Mechanistic Reasoning Engine"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask to derive a bounded STDP rule, verify C++20 cache-line alignment, or test a tau delay sweep..."
          className="flex-1 px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isSending ? 'Synthesizing Turn…' : 'Send Turn'}</span>
        </button>
      </form>
    </section>
  );
};
