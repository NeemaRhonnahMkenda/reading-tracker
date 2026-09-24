"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Login error:", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    console.log("Successfully logged in:", data.user);
    console.log("User ID:", data.user.id);

    router.push("/library");
  }

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-slate-800 font-sans relative overflow-hidden">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');

            .font-classical {
              font-family: 'Playfair Display', serif;
            }
          `,
        }}
      />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={false} />

      <section className="min-h-[calc(100vh-120px)] flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-[#0f172a]/5 p-8 md:p-10">
          <div className="text-center mb-8">
            <p className="uppercase tracking-[0.25em] text-xs text-[#7a947c] font-medium mb-3">
              Welcome back
            </p>

            <h1 className="text-4xl font-classical font-semibold text-[#0f172a]">
              Sign In
            </h1>

            <p className="mt-3 text-slate-500 font-light">
              Return to your personal archive.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@example.com"
                className="w-full h-12 px-4 bg-[#Fdfaf3] border border-slate-200 rounded-lg focus:outline-none focus:border-[#7a947c] focus:ring-1 focus:ring-[#7a947c]/30 transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                placeholder="••••••••"
                className="w-full h-12 px-4 bg-[#Fdfaf3] border border-slate-200 rounded-lg focus:outline-none focus:border-[#7a947c] focus:ring-1 focus:ring-[#7a947c]/30 transition-all"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0f172a] text-[#Fdfaf3] py-3.5 rounded-full hover:bg-[#1b2940] disabled:opacity-50 transition-all"
            >
              {loading ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-7">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-[#7a947c] hover:text-[#6b826c]"
            >
              Create one
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}