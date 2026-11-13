import React from 'react';
import { SilverVerificationPanel, SilverVerificationsState } from './SilverVerificationPanel';

export type SilverVerificationPayload = SilverVerificationsState;

export async function fetchSilverVerifications(
  daemonUrl = ''
): Promise<SilverVerificationPayload> {
  const res = await fetch(`${daemonUrl}/silver-verifications`);
  if (!res.ok) {
    throw new Error(`Sync daemon returned HTTP ${res.status}`);
  }
  return res.json();
}

export async function runSilverVerify(
  daemonUrl = '',
  dryRun = false
): Promise<SilverVerificationPayload & { status: string; returncode: number }> {
  const res = await fetch(`${daemonUrl}/silver-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dry_run: dryRun, unit_test_args: '--json' }),
  });
  if (!res.ok) {
    throw new Error(`Verification trigger failed: HTTP ${res.status}`);
  }
  return res.json();
}

export interface AntigravityBridgeWorkspaceProps {
  daemonUrl?: string;
  externalIngestTrigger?: { promptId: string; rawOutput: string; nonce: number } | null;
}

export function AntigravityBridgeWorkspace({
  daemonUrl = '',
  externalIngestTrigger = null,
}: AntigravityBridgeWorkspaceProps) {
  return (
    <div className="w-full">
      <SilverVerificationPanel
        daemonBaseUrl={daemonUrl}
        externalIngestTrigger={externalIngestTrigger}
      />
    </div>
  );
}

export default AntigravityBridgeWorkspace;
