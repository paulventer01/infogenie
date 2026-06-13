import styles from "../../styles/auth.module.css";

// Minimal shell for the auth pages — no navbar. Provides the centred card
// background (radial gradient over deep navy) baked into each legacy HTML file.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.page}>{children}</div>;
}
