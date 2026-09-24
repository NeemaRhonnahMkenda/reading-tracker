"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "../../../components/Navbar";
import { supabase } from "../../../../lib/supabase";

interface Invitation {
  family_name: string;
  status: string;
  expires_at: string | null;
}

export default function FamilyInvitePage() {
  const params = useParams();
  const router = useRouter();

  const inviteId = params.inviteId as string;

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!inviteId) return;

    loadInvitation();
  }, [inviteId]);

  const loadInvitation = async () => {
    setLoading(true);
    setError("");

    try {
      // Check whether the visitor is logged in
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.email) {
        setUserEmail(session.user.email);
      }

      // Get safe invitation details
      const { data, error: invitationError } = await supabase.rpc(
        "get_family_invitation",
        {
          p_invite_id: inviteId,
        }
      );

      if (invitationError) {
        console.error("Error loading invitation:", invitationError);
        setError("We couldn't load this invitation.");
        return;
      }

      const invitationData = Array.isArray(data) ? data[0] : data;

      if (!invitationData) {
        setError(
          "This invitation could not be found. It may have been deleted or the link may be incorrect."
        );
        return;
      }

      setInvitation(invitationData);
    } catch (err) {
      console.error("Unexpected invitation error:", err);
      setError("Something went wrong while loading the invitation.");
    } finally {
      setLoading(false);
    }
  };

  const acceptInvitation = async () => {
    setAccepting(true);
    setError("");
    setSuccess("");

    try {
      // Make sure the user is logged in
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        const redirectUrl = `/family/invite/${encodeURIComponent(
          inviteId
        )}`;

        router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
        return;
      }

      const { data: familyId, error: acceptError } = await supabase.rpc(
        "accept_family_invitation",
        {
          p_invite_id: inviteId,
        }
      );

      if (acceptError) {
        console.error("Error accepting invitation:", acceptError);

        // Convert some of the database errors into friendlier messages
        if (
          acceptError.message.includes(
            "different email address"
          )
        ) {
          setError(
            "This invitation was sent to a different email address. Please sign in using the email address that received the invitation."
          );
        } else if (
          acceptError.message.includes("already been used")
        ) {
          setError(
            "This invitation has already been accepted or is no longer available."
          );
        } else if (
          acceptError.message.includes("expired")
        ) {
          setError(
            "This invitation has expired. Please ask the family owner to send you a new invitation."
          );
        } else {
          setError(
            acceptError.message ||
              "We couldn't accept the invitation. Please try again."
          );
        }

        return;
      }

      console.log("Successfully joined family:", familyId);

      setSuccess("You've successfully joined the family library!");

      // Give the success message a moment before redirecting
      setTimeout(() => {
        router.push("/family");
      }, 1200);
    } catch (err) {
      console.error("Unexpected acceptance error:", err);
      setError("Something went wrong while accepting the invitation.");
    } finally {
      setAccepting(false);
    }
  };

  const signIn = () => {
    const redirectUrl = `/family/invite/${encodeURIComponent(inviteId)}`;

    router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
  };

  const createAccount = () => {
    const redirectUrl = `/family/invite/${encodeURIComponent(inviteId)}`;

    router.push(`/signup?redirect=${encodeURIComponent(redirectUrl)}`);
  };

  const isExpired =
    invitation?.expires_at &&
    new Date(invitation.expires_at).getTime() < Date.now();

  const isUnavailable =
    invitation?.status && invitation.status !== "pending";

  return (
    <div className="min-h-screen bg-[#fdfaf3] text-[#0f172a]">
      <Navbar />

      <main className="flex min-h-[calc(100vh-80px)] items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          {/* Loading */}
          {loading && (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-[#d8d0e3] border-t-[#7a947c]" />

              <p className="text-sm text-gray-500">
                Loading your invitation...
              </p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#f1e8e8] text-2xl">
                !
              </div>

              <h1
                className="mb-4 text-3xl"
                style={{ fontFamily: "Georgia, serif" }}
              >
                Invitation unavailable
              </h1>

              <p className="mx-auto mb-8 max-w-md text-sm leading-6 text-gray-600">
                {error}
              </p>

              <button
                onClick={() => router.push("/family")}
                className="rounded-full bg-[#7a947c] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#6b826c]"
              >
                Go to Family Library
              </button>
            </div>
          )}

          {/* Invitation */}
          {!loading && !error && invitation && (
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
              {/* Header */}
              <div className="bg-[#d8d0e3] px-8 py-10 text-center sm:px-12">
                <p className="mb-3 text-xs uppercase tracking-[0.25em] text-[#5d5965]">
                  The Archive
                </p>

                <h1
                  className="text-4xl leading-tight sm:text-5xl"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  You&apos;re invited
                </h1>

                <p className="mt-4 text-sm text-[#5d5965]">
                  to join a shared family library
                </p>
              </div>

              {/* Body */}
              <div className="px-8 py-10 sm:px-12">
                <div className="text-center">
                  <p className="mb-3 text-sm text-gray-500">
                    You&apos;ve been invited to join
                  </p>

                  <h2
                    className="text-3xl"
                    style={{ fontFamily: "Georgia, serif" }}
                  >
                    {invitation.family_name}
                  </h2>

                  <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-gray-600">
                    Share books, discover what your family is reading,
                    and keep your reading life together in one place.
                  </p>
                </div>

                {/* Status */}
                {isExpired && (
                  <div className="mt-8 rounded-2xl bg-[#f7eeee] px-5 py-4 text-center">
                    <p className="text-sm font-medium text-[#8b5e5e]">
                      This invitation has expired.
                    </p>

                    <p className="mt-1 text-xs text-[#8b5e5e]">
                      Please ask the family owner to send you a new
                      invitation.
                    </p>
                  </div>
                )}

                {isUnavailable && !isExpired && (
                  <div className="mt-8 rounded-2xl bg-[#f5f2eb] px-5 py-4 text-center">
                    <p className="text-sm font-medium text-gray-700">
                      This invitation is no longer available.
                    </p>
                  </div>
                )}

                {/* Logged-in user */}
                {userEmail &&
                  invitation.status === "pending" &&
                  !isExpired && (
                    <div className="mt-8">
                      <div className="mb-5 rounded-2xl bg-[#f7f8f4] px-5 py-4 text-center">
                        <p className="text-xs uppercase tracking-wider text-gray-400">
                          Signed in as
                        </p>

                        <p className="mt-1 text-sm font-medium text-gray-700">
                          {userEmail}
                        </p>
                      </div>

                      {success ? (
                        <div className="rounded-2xl bg-[#edf4ee] px-5 py-4 text-center">
                          <p className="text-sm font-medium text-[#55715a]">
                            {success}
                          </p>

                          <p className="mt-1 text-xs text-[#6d7e70]">
                            Taking you to your family library...
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={acceptInvitation}
                          disabled={accepting}
                          className="w-full rounded-full bg-[#7a947c] px-6 py-4 text-sm font-medium text-white transition hover:bg-[#6b826c] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {accepting
                            ? "Accepting invitation..."
                            : "Accept Invitation"}
                        </button>
                      )}
                    </div>
                  )}

                {/* Logged-out user */}
                {!userEmail &&
                  invitation.status === "pending" &&
                  !isExpired && (
                    <div className="mt-8">
                      <button
                        onClick={signIn}
                        className="w-full rounded-full bg-[#7a947c] px-6 py-4 text-sm font-medium text-white transition hover:bg-[#6b826c]"
                      >
                        Sign In to Accept
                      </button>

                      <button
                        onClick={createAccount}
                        className="mt-3 w-full rounded-full border border-[#d8d0e3] px-6 py-4 text-sm font-medium text-[#0f172a] transition hover:bg-[#faf8f2]"
                      >
                        Create an Account
                      </button>

                      <p className="mt-5 text-center text-xs leading-5 text-gray-400">
                        You&apos;ll need to use the email address that
                        received this invitation.
                      </p>
                    </div>
                  )}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-8 py-5 text-center">
                <p className="text-xs text-gray-400">
                  The Archive · A shared reading space
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}