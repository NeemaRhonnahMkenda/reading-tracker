"use client";

// src/app/wishlist/ShareWishlistCard.tsx
// Lets the signed-in user create, copy, replace or turn off their share link.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

interface ShareRow {
  token: string;
  enabled: boolean;
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export default function ShareWishlistCard({ userId, itemCount }: { userId: string | null; itemCount: number }) {
  const [share, setShare] = useState<ShareRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from("wishlist_shares")
      .select("token, enabled")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          console.error("Share link load failed:", loadError.message);
          setError("Your share link couldn't be loaded.");
        } else {
          setShare(data as ShareRow | null);
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const shareUrl = share ? `${origin}/share/wishlist/${share.token}` : "";

  async function createOrRotate(confirmReplace: boolean) {
    if (
      confirmReplace &&
      !window.confirm("Make a new link? Anyone with the old link won't be able to open it any more.")
    ) {
      return;
    }

    setWorking(true);
    setError("");

    const { data, error: rpcError } = await supabase.rpc("rotate_wishlist_share");

    setWorking(false);

    if (rpcError || !data) {
      console.error("Share link create failed:", rpcError?.message);
      setError("The link couldn't be created. Try again.");
      return;
    }

    setShare({ token: data as string, enabled: true });
  }

  async function setEnabled(enabled: boolean) {
    if (!userId) return;

    setWorking(true);
    setError("");

    const { error: updateError } = await supabase
      .from("wishlist_shares")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    setWorking(false);

    if (updateError) {
      console.error("Share toggle failed:", updateError.message);
      setError(enabled ? "Sharing couldn't be turned on. Try again." : "Sharing couldn't be turned off. Try again.");
      return;
    }

    setShare((current) => (current ? { ...current, enabled } : current));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Copying didn't work. Select the link and copy it instead.");
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({
        title: "My book wishlist",
        text: "Here are the books I'd love to read.",
        url: shareUrl,
      });
    } catch {
      // User closed the share sheet; nothing to do
    }
  }

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <section
      aria-labelledby="share-heading"
      className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-5 sm:p-7"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="w-11 h-11 rounded-full bg-[#d8d0e3]/50 text-[#0f172a] flex items-center justify-center shrink-0"
        >
          <GiftIcon />
        </span>
        <div className="flex-1 min-w-0">
          <h2 id="share-heading" className="font-classical text-2xl font-semibold">
            Share your wishlist
          </h2>
          <p className="text-sm text-slate-500 mt-1 leading-6">
            Send a link when someone asks what books to get you. They don&apos;t need an account, and they can only view it.
          </p>
        </div>
      </div>

      <div className="mt-5" aria-live="polite">
        {loading ? (
          <div className="h-12 rounded-xl bg-[#0f172a]/[0.05] animate-pulse" aria-label="Loading share link" />
        ) : !share ? (
          <button
            type="button"
            onClick={() => createOrRotate(false)}
            disabled={working || !userId}
            className={`h-11 px-6 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium hover:bg-[#7a947c] disabled:opacity-50 transition-colors ${focusRing}`}
          >
            {working ? "Creating link…" : "Create share link"}
          </button>
        ) : !share.enabled ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 text-sm text-slate-500">Sharing is off. Your old link shows a “not available” page.</p>
            <button
              type="button"
              onClick={() => setEnabled(true)}
              disabled={working}
              className={`h-11 px-6 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium hover:bg-[#7a947c] disabled:opacity-50 transition-colors ${focusRing}`}
            >
              Turn sharing on
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="share-url" className="sr-only">
              Your wishlist link
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="share-url"
                type="text"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 h-11 px-4 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-sm text-slate-600 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className={`flex-1 sm:flex-none h-11 px-5 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium hover:bg-[#7a947c] transition-colors ${focusRing}`}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    onClick={nativeShare}
                    className={`flex-1 sm:flex-none h-11 px-5 rounded-full border border-[#7a947c] text-[#4a5c4b] text-sm font-medium hover:bg-[#7a947c] hover:text-white transition-colors ${focusRing}`}
                  >
                    Share
                  </button>
                )}
              </div>
            </div>

            {itemCount === 0 && (
              <p className="text-xs text-[#8a6a22] mt-3">Your wishlist is empty, so the link will show no books yet.</p>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-sm">
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
              >
                Preview
              </a>
              <button
                type="button"
                onClick={() => createOrRotate(true)}
                disabled={working}
                className={`text-slate-500 hover:text-[#0f172a] disabled:opacity-50 rounded ${focusRing}`}
              >
                Make a new link
              </button>
              <button
                type="button"
                onClick={() => setEnabled(false)}
                disabled={working}
                className={`text-slate-500 hover:text-[#a14e43] disabled:opacity-50 rounded ${focusRing}`}
              >
                Turn off sharing
              </button>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-[#a14e43]">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function GiftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v9h14v-9" />
      <path d="M12 8c-1.5-3-5-3.5-5-1.5S10 8 12 8zM12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z" />
    </svg>
  );
}