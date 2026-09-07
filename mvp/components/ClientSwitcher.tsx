"use client";

import { useRouter } from "next/navigation";
import styles from "@/styles/mvp.module.css";

export default function ClientSwitcher({
  clients,
  activeClientId,
}: {
  clients: { id: string; name: string }[];
  activeClientId: string | null;
}) {
  const router = useRouter();

  return (
    <select
      className={styles.clientSelect}
      value={activeClientId || ""}
      onChange={(e) => {
        const id = e.target.value;
        if (!id) return;
        fetch("/api/clients/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: id }),
        }).then(() => router.refresh());
      }}
    >
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
