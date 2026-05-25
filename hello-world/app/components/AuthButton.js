"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function AuthButton() {
  const [user, setUser] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });

  const signOut = () => supabase.auth.signOut();

  if (!user) {
    return (
      <button onClick={signIn} style={styles.btn}>
        Sign in with Google
      </button>
    );
  }

  return (
    <div style={styles.row}>
      <span style={styles.email}>{user.email}</span>
      <button onClick={signOut} style={{ ...styles.btn, ...styles.outlineBtn }}>
        Sign out
      </button>
    </div>
  );
}

const styles = {
  row: { display: "flex", alignItems: "center", gap: 12 },
  email: { fontSize: 13, color: "var(--text-secondary)" },
  btn: {
    fontSize: 13,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: "var(--accent)",
    color: "#fff",
    cursor: "pointer",
  },
  outlineBtn: {
    background: "transparent",
    border: "1px solid var(--border-strong)",
    color: "var(--text-primary)",
  },
};
