import type { GateVerdict } from "@/lib/api";

const CHECK_LABELS: Record<string, string> = {
  brand_context: "Brand context",
  prohibited_terms: "Prohibited terms",
  claims: "Legal & claims",
  pii_leakage: "PII leakage",
  consent_suppression: "Consent & suppression",
  autonomy: "Autonomy level",
  reversibility: "Reversibility",
  gate_error: "Gate error",
};

/** §5.6 — gate rejection reasons are surfaced in the interface, never buried in
 * logs. Renders the seven-check verdict exactly as the gate produced it. */
export default function GateChecklist({ gate }: { gate: GateVerdict }) {
  return (
    <div className="gate-list">
      {gate.checks.map((c) => (
        <div className="gate-row" key={c.check}>
          <span className="c">{CHECK_LABELS[c.check] ?? c.check}</span>
          <span className="r">{c.reason}</span>
          <span className={`pill ${c.status}`}>
            {c.status === "not_applicable" ? "n/a" : c.status}
          </span>
        </div>
      ))}
    </div>
  );
}
