"use client";

import { ActionButton } from "@/components/ActionButton";
import { login } from "@/lib/api";
import { Camera } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-line bg-panel p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-white">
            <Camera className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Photo AI</h1>
            <p className="text-sm text-muted">Sign in to continue</p>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-semibold">Email</span>
          <input
            className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-semibold">Password</span>
          <input
            className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-danger">{error}</p>}

        <ActionButton className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </ActionButton>

        <p className="mt-4 text-center text-sm text-muted">
          No account?{" "}
          <Link className="font-semibold text-accent hover:underline" href="/register">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}
