import { getSessionWorkspace } from "@/lib/session";
import { PageHeader, NeedAnalysis } from "@/components/PageHeader";
import styles from "@/styles/mvp.module.css";

export default async function KeywordsPage() {
  const ws = await getSessionWorkspace();
  const a = ws?.analysis;
  if (!a) return <NeedAnalysis />;

  return (
    <>
      <PageHeader
        eyebrow="Day 1 · Demand"
        title="Keyword opportunities"
        sub="Bridge analysis into content and landing briefs."
      />
      <div className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Volume</th>
              <th>Difficulty</th>
              <th>Intent</th>
              <th>Opportunity</th>
            </tr>
          </thead>
          <tbody>
            {a.keywords.map((k) => (
              <tr key={k.keyword}>
                <td>
                  <strong>{k.keyword}</strong>
                </td>
                <td>{k.volume}</td>
                <td>{k.difficulty}</td>
                <td>{k.intent}</td>
                <td className={styles.muted}>{k.opportunity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
