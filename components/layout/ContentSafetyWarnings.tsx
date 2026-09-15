"use client";

interface Props {
  warnings?: string[] | null;
  style?: React.CSSProperties;
}

/** Warning-only content safety banner — matches Safe Agent styling. */
export default function ContentSafetyWarnings({ warnings, style }: Props) {
  if (!warnings?.length) return null;
  return (
    <div
      style={{
        background: "#FEF3C7",
        border: "1px solid #F59E0B",
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        ...style,
      }}
    >
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#92400E", marginBottom: 6 }}>
        CONTENT SAFETY WARNINGS
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: "#78350F" }}>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
