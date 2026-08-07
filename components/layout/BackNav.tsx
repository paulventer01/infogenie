"use client";

import { useRouter } from "next/navigation";
import styles from "../../styles/shell.module.css";

const BACK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

/** Returns to the previous page in browser history (fallback: home). */
export default function BackNav({ fallback = "/" }: { fallback?: string }) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return (
    <button
      type="button"
      className={styles.backBtn}
      onClick={goBack}
      aria-label="Go back to previous page"
      title="Back to previous page"
    >
      <span dangerouslySetInnerHTML={{ __html: BACK_SVG }} aria-hidden />
      <span className={styles.backLabel}>Back</span>
    </button>
  );
}
