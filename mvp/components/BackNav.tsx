"use client";

import { useRouter } from "next/navigation";
import styles from "@/styles/mvp.module.css";

/** Returns to the previous page in browser history (fallback: Analyse home). */
export default function BackNav({ fallback = "/analyse" }: { fallback?: string }) {
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
      <span aria-hidden>←</span>
      <span>Back</span>
    </button>
  );
}
