import styles from "../../styles/auth.module.css";

// Minimal shell for auth pages — atmospheric page background, no navbar.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.page}>{children}</div>;
}
