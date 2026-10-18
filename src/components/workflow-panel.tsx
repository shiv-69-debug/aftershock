"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { AgentHandoff, Investigation, SandboxReceipt } from "@/lib/types";
import "./workflow-panel.css";

type Item = {
  handoff: AgentHandoff;
  receipt: SandboxReceipt | null;
  verification: { verified: boolean } | null;
};

export function WorkflowPanel({
  investigation,
  disabled,
  connected,
  onBusyChange,
  apiRoot = "/api",
}: {
  investigation: Investigation | null;
  disabled: boolean;
  connected: boolean;
  onBusyChange: (busy: boolean) => void;
  apiRoot?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!connected) return;
    const response = await fetch(`${apiRoot}/workflow`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not read workflow status.");
    setItems(data.items);
  }, [connected, apiRoot]);
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
  }, [refresh, investigation?.id]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  async function act(body: object) {
    if (disabled || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const response = await fetch(`${apiRoot}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Workflow operation failed.");
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Workflow request failed.",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const eligible =
    investigation?.policyVersion === 2 && investigation.action !== "hold";
  const alreadyHandedOff = items.some(
    (item) => item.handoff.runId === investigation?.id,
  );

  return (
    <section className="workflow-panel" aria-labelledby="workflow-title">
      <header>
        <div>
          <span className="eyebrow">PERSISTED AGENT WORKFLOW</span>
          <h2 id="workflow-title">Hand off. Execute. Verify.</h2>
          <p>Investigator → FalkorDB handoff → responder → isolated sandbox.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh handoff verification"
          disabled={busy || !connected}
          onClick={() =>
            void refresh().catch((error) => setError(error.message))
          }
        >
          <RefreshCw size={17} />
        </button>
      </header>
      <div className="workflow-scope">
        <ShieldAlert size={17} />
        <p>
          This changes only a per-handoff sandbox configuration. Verification
          replays a synthetic request against its persisted timeout. No payment
          provider, production service, or paging system is contacted.
        </p>
      </div>
      <div className="workflow-start">
        <p>
          {eligible
            ? "The current investigation has an evidence-backed sandbox proposal."
            : "Run an investigation with complete runbook and compatibility evidence to create a handoff. A hold cannot be executed."}
        </p>
        <button
          className="primary-button"
          disabled={disabled || busy || !eligible || alreadyHandedOff}
          onClick={() =>
            void act({ action: "handoff", runId: investigation!.id })
          }
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <GitBranch size={16} />
          )}
          {alreadyHandedOff ? "Handoff persisted" : "Hand off to responder"}
        </button>
      </div>
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="workflow-empty">
          No handoffs yet. Investigation audit records alone are not evidence
          that an action was executed.
        </p>
      ) : (
        <div className="workflow-items">
          {items.map(({ handoff, receipt, verification }) => (
            <article key={handoff.id} className="workflow-item">
              <div className="workflow-item-heading">
                <div>
                  <strong>
                    {handoff.from} <ArrowRight size={14} /> {handoff.to}
                  </strong>
                  <span>
                    Handoff {handoff.id.slice(0, 8)} ·{" "}
                    {handoff.action.replaceAll("_", " ")}
                  </span>
                </div>
                <span className="tiny-badge">
                  {receipt
                    ? verification?.verified
                      ? "SANDBOX VERIFIED"
                      : "VERIFICATION FAILED"
                    : "PENDING — NOT EXECUTED"}
                </span>
              </div>
              {receipt ? (
                <>
                  <div className="workflow-diff">
                    <div>
                      <small>BEFORE</small>
                      <strong>
                        {receipt.before.timeoutMs.toLocaleString()} ms
                      </strong>
                      <span>
                        fast_payments: {String(receipt.before.fastPayments)}
                      </span>
                      <span>release: {receipt.before.release}</span>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <small>AFTER</small>
                      <strong>
                        {receipt.after.timeoutMs.toLocaleString()} ms
                      </strong>
                      <span>
                        fast_payments: {String(receipt.after.fastPayments)}
                      </span>
                      <span>release: {receipt.after.release}</span>
                    </div>
                  </div>
                  <p
                    className={
                      verification?.verified
                        ? "workflow-verified"
                        : "workflow-error"
                    }
                  >
                    {verification?.verified ? (
                      <Check size={16} />
                    ) : (
                      <ShieldAlert size={16} />
                    )}
                    Replay: {receipt.beforeProbe.outcome} →{" "}
                    {receipt.afterProbe.outcome}.{" "}
                    {verification?.verified
                      ? "Current sandbox state matches the execution receipt."
                      : "The current sandbox no longer matches the recorded result."}
                  </p>
                </>
              ) : (
                <div className="workflow-pending">
                  <p>
                    The responder will load this handoff from FalkorDB,
                    revalidate its evidence digest and constraints, then execute
                    the authorized sandbox mutation once.
                  </p>
                  <button
                    className="primary-button"
                    disabled={disabled || busy}
                    onClick={() =>
                      void act({ action: "execute", handoffId: handoff.id })
                    }
                  >
                    Run sandbox action <ArrowRight size={15} />
                  </button>
                </div>
              )}
              <div className="workflow-links">
                <a
                  href={`${apiRoot}/sandbox/${handoff.sandboxId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Probe sandbox <ExternalLink size={13} />
                </a>
                <details>
                  <summary>Inspect provenance</summary>
                  <p>
                    <strong>Investigation:</strong> {handoff.runId}
                  </p>
                  <p>
                    <strong>Evidence digest:</strong> {handoff.evidenceDigest}
                  </p>
                  <p>
                    <strong>Evidence nodes:</strong>{" "}
                    {handoff.evidenceIds.join(", ")}
                  </p>
                  {receipt && (
                    <>
                      <p>
                        <strong>Receipt:</strong> {receipt.id}
                      </p>
                      <p>
                        <strong>Fresh verification investigation:</strong>{" "}
                        {receipt.verificationRunId}
                      </p>
                      <pre>{JSON.stringify(receipt, null, 2)}</pre>
                    </>
                  )}
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
