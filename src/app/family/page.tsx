"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

// ============================================================
// Types
// ============================================================

interface Family {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

interface Member {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  joined_at: string;
}

interface MemberMeta {
  isMe: boolean;
  /** Short label for chips and badges: "You", "@username" or display name */
  label: string;
  /** Full identity for lists: "@username" or display name */
  name: string;
  avatarUrl: string | null;
  color: string;
}

interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
  status: string | null;
  added_at: string | null;
  created_at: string;
}

interface FamilyInvite {
  id: string;
  invited_email: string;
  status: string;
  created_at: string;
  expires_at: string;
}

type Notice = { type: "error" | "success"; message: string } | null;

// ============================================================
// Config
// ============================================================

const COVER_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const SIGNED_URL_TTL = 60 * 60;

const MEMBER_COLORS = ["#7a947c", "#9a86b9", "#c5a24a", "#0f172a", "#b07a6a", "#5f7f99"];

const STATUS_FILTERS = [
  { value: "all", label: "Any status" },
  { value: "reading", label: "Reading" },
  { value: "want_to_read", label: "Want to read" },
  { value: "finished", label: "Finished" },
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_META: MemberMeta = {
  isMe: false,
  label: "Family",
  name: "Family member",
  avatarUrl: null,
  color: MEMBER_COLORS[0],
};

// ============================================================
// Helpers
// ============================================================

function statusLabel(status: string | null) {
  switch (status) {
    case "reading":
      return "Reading";
    case "finished":
      return "Finished";
    case "want_to_read":
      return "Want to read";
    default:
      return "No status";
  }
}

function initials(name: string) {
  const cleaned = name.replace(/^@/, "").trim();
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

// ============================================================
// Small components
// ============================================================

function Avatar({
  name,
  color,
  imageUrl,
  size = "md",
  ring = false,
}: {
  name: string;
  color: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  const sizes = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
  };

  const base = `${sizes[size]} rounded-full shrink-0 overflow-hidden ${ring ? "ring-2 ring-[#Fdfaf3]" : ""}`;

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${base} object-cover bg-slate-200`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${base} flex items-center justify-center text-white font-semibold`}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </span>
  );
}

function CoverImage({
  sources,
  title,
  author,
}: {
  sources: string[];
  title: string;
  author: string | null;
}) {
  const [index, setIndex] = useState(0);
  const key = sources.join("|");

  useEffect(() => {
    setIndex(0);
  }, [key]);

  const src = sources[index];

  if (src) {
    return (
      <img
        src={src}
        alt={`Cover of ${title}`}
        loading="lazy"
        onError={() => setIndex((i) => i + 1)}
        className="w-full h-full object-cover"
      />
    );
  }

  return (
    <div className="w-full h-full p-5 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
      <span className="text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
      <div>
        <p className="font-classical text-lg leading-tight line-clamp-4">{title}</p>
        {author && <p className="text-xs opacity-70 mt-2 line-clamp-2">{author}</p>}
      </div>
      <span className="self-end font-classical text-xl opacity-40">A</span>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  if (!notice) return null;

  const isError = notice.type === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-3 px-5 py-4 rounded-2xl border text-sm ${
        isError
          ? "bg-[#f8e9e5] border-[#e8cbc4] text-[#a14e43]"
          : "bg-[#eef3ee] border-[#7a947c]/25 text-[#4a5c4b]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold text-white ${
          isError ? "bg-[#c0675b]" : "bg-[#7a947c]"
        }`}
      >
        {isError ? "!" : "✓"}
      </span>
      <p className="flex-1 leading-6">{notice.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className={`text-lg leading-none opacity-60 hover:opacity-100 rounded ${focusRing}`}
      >
        ×
      </button>
    </div>
  );
}

function FontStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');
          .font-classical { font-family: 'Playfair Display', Georgia, serif; }
        `,
      }}
    />
  );
}

// ============================================================
// Page
// ============================================================

export default function FamilyPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [signedCovers, setSignedCovers] = useState<Record<string, string>>({});
  const [invites, setInvites] = useState<FamilyInvite[]>([]);

  const [loading, setLoading] = useState(true);
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  const [familyName, setFamilyName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [notice, setNotice] = useState<Notice>(null);

  const showError = (message: string) => setNotice({ type: "error", message });
  const showSuccess = (message: string) => setNotice({ type: "success", message });

  // ============================================================
  // Load family
  // ============================================================

  const loadFamily = useCallback(async () => {
    setLoading(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Session error:", sessionError.message);
        showError("We couldn't verify your sign-in. Sign in again to continue.");
        return;
      }

      if (!session?.user) {
        router.push("/login");
        return;
      }

      const currentUserId = session.user.id;
      setUserId(currentUserId);

      // ---- Membership -------------------------------------------------
      const { data: membership, error: membershipError } = await supabase
        .from("family_members")
        .select("family_id")
        .eq("user_id", currentUserId)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        console.error("Membership query failed:", membershipError.message);
        showError("We couldn't check your family membership. Check the family table policies.");
        return;
      }

      if (!membership) {
        setFamily(null);
        setMembers([]);
        setBooks([]);
        setInvites([]);
        return;
      }

      const familyId = membership.family_id as string;

      // ---- Family, members, invites in parallel -----------------------
      const [familyResult, membersResult, invitesResult] = await Promise.all([
        supabase.from("families").select("*").eq("id", familyId).single(),
        supabase.rpc("family_member_profiles", { fid: familyId }),
        supabase
          .from("family_invites")
          .select("id, invited_email, status, created_at, expires_at")
          .eq("family_id", familyId)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);

      if (familyResult.error || !familyResult.data) {
        console.error("Family load failed:", familyResult.error?.message);
        showError("We couldn't load your family. Try again.");
        return;
      }

      setFamily(familyResult.data as Family);

      // Members: prefer the RPC (names, usernames, avatars in one call).
      // Fallback: membership rows + profiles table.
      let loadedMembers: Member[] = [];

      if (membersResult.error) {
        console.warn(
          "family_member_profiles RPC unavailable, falling back:",
          membersResult.error.message
        );

        const { data: rows, error: rowsError } = await supabase
          .from("family_members")
          .select("user_id, joined_at")
          .eq("family_id", familyId)
          .order("joined_at", { ascending: true });

        if (rowsError) {
          console.error("Members load failed:", rowsError.message);
          showError("We couldn't load your family members. Try again.");
          return;
        }

        const ids = (rows || []).map((r) => r.user_id as string);

        const { data: profileRows, error: profilesError } = ids.length
          ? await supabase.from("profiles").select("id, username, avatar_url").in("id", ids)
          : { data: [], error: null };

        if (profilesError) console.error("Profiles load failed:", profilesError.message);

        const profileById = new Map(
          (profileRows || []).map((p) => [
            p.id as string,
            p as { username: string | null; avatar_url: string | null },
          ])
        );

        loadedMembers = (rows || []).map((row, i) => {
          const profile = profileById.get(row.user_id);
          return {
            user_id: row.user_id,
            joined_at: row.joined_at,
            username: profile?.username ?? null,
            avatar_url: profile?.avatar_url ?? null,
            display_name: profile?.username || `Member ${i + 1}`,
          };
        });
      } else {
        loadedMembers = ((membersResult.data || []) as Member[]).map((m) => ({
          ...m,
          username: m.username ?? null,
          avatar_url: m.avatar_url ?? null,
        }));
      }

      setMembers(loadedMembers);

      if (invitesResult.error) {
        console.error("Invites load failed:", invitesResult.error.message);
        setInvites([]);
      } else {
        setInvites((invitesResult.data || []) as FamilyInvite[]);
      }

      // ---- Books for every member -------------------------------------
      const memberIds = loadedMembers.map((m) => m.user_id);

      if (memberIds.length === 0) {
        setBooks([]);
        return;
      }

      const { data: booksData, error: booksError } = await supabase
        .from("books")
        .select("id, user_id, title, author, cover_url, custom_cover_path, status, added_at, created_at")
        .in("user_id", memberIds)
        .order("created_at", { ascending: false });

      if (booksError) {
        console.error("Family books load failed:", booksError.message);
        showError("We couldn't load the shared library. Try again.");
        return;
      }

      const loadedBooks = (booksData || []) as Book[];
      setBooks(loadedBooks);

      // Diagnostic: RLS silently filters rows rather than erroring
      const owners = new Set(loadedBooks.map((b) => b.user_id));
      if (memberIds.length > 1 && owners.size <= 1) {
        console.warn(
          "Only your own books were returned. If other members have books, the books SELECT policy is not allowing family access."
        );
      }

      // Signed URLs for custom covers
      const paths = Array.from(
        new Set(loadedBooks.map((b) => b.custom_cover_path).filter((p): p is string => !!p))
      );

      if (paths.length > 0) {
        const { data: signed, error: signError } = await supabase.storage
          .from(COVER_BUCKET)
          .createSignedUrls(paths, SIGNED_URL_TTL);

        if (signError) {
          console.error("Cover signing failed:", signError.message);
        } else if (signed) {
          const map: Record<string, string> = {};
          signed.forEach((item) => {
            if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
          });
          setSignedCovers(map);
        }
      }
    } catch (err) {
      console.error("Unexpected family error:", err);
      showError("Something went wrong while loading your family.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadFamily();
  }, [loadFamily]);

  // ============================================================
  // Create family
  // ============================================================

  async function createFamily(event?: FormEvent) {
    event?.preventDefault();

    const name = familyName.trim();

    if (!name) {
      showError("Enter a name for your family library.");
      return;
    }

    setCreatingFamily(true);
    setNotice(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.push("/login");
        return;
      }

      const newFamilyId = crypto.randomUUID();

      const { error: familyError } = await supabase.from("families").insert({
        id: newFamilyId,
        name,
        created_by: user.id,
      });

      if (familyError) {
        console.error("Family create failed:", familyError.message);
        showError("Your family couldn't be created. Try again.");
        return;
      }

      const { error: memberError } = await supabase.from("family_members").insert({
        family_id: newFamilyId,
        user_id: user.id,
      });

      if (memberError) {
        console.error("Adding creator failed:", memberError.message);

        await supabase.from("families").delete().eq("id", newFamilyId).eq("created_by", user.id);

        showError("Your family couldn't be set up. Try again.");
        return;
      }

      setFamilyName("");
      await loadFamily();
      showSuccess(`${name} is ready. Invite someone to start sharing books.`);
    } catch (err) {
      console.error("Unexpected family creation error:", err);
      showError("Something went wrong while creating the family.");
    } finally {
      setCreatingFamily(false);
    }
  }

  // ============================================================
  // Send invitation
  // ============================================================

  async function sendInvite(event?: FormEvent) {
    event?.preventDefault();

    if (!family || !userId) return;

    const email = inviteEmail.trim().toLowerCase();

    if (!email) {
      showError("Enter an email address to send an invitation.");
      return;
    }

    if (!EMAIL_PATTERN.test(email)) {
      showError("That email address doesn't look right. Check it and try again.");
      return;
    }

    setSendingInvite(true);
    setNotice(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        showError("Your sign-in has expired. Sign in again to send invitations.");
        return;
      }

      const { data: existingInvite, error: existingError } = await supabase
        .from("family_invites")
        .select("id")
        .eq("family_id", family.id)
        .eq("invited_email", email)
        .eq("status", "pending")
        .maybeSingle();

      if (existingError) {
        console.error("Invite check failed:", existingError.message);
        showError("We couldn't check existing invitations. Try again.");
        return;
      }

      if (existingInvite) {
        showError(`${email} already has a pending invitation.`);
        return;
      }

      const invitationId = crypto.randomUUID();

      const { error: inviteError } = await supabase.from("family_invites").insert({
        id: invitationId,
        family_id: family.id,
        invited_email: email,
        invited_by: user.id,
      });

      if (inviteError) {
        console.error("Invite create failed:", inviteError.message);
        showError("The invitation couldn't be created. Try again.");
        return;
      }

      // Prefer the inviter's username so the email matches what the family sees
      const myMember = members.find((m) => m.user_id === user.id);
      const inviterName =
        (myMember?.username && `@${myMember.username}`) ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "A family member";

      const response = await fetch("/api/family-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          familyName: family.name,
          inviterName,
          inviteId: invitationId,
        }),
      });

      let result: { success?: boolean; error?: string } | null = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok || !result?.success) {
        console.error("Invite email failed:", result);
        showError("The invitation was saved, but the email didn't send. Try sending it again later.");
        await loadFamily();
        return;
      }

      setInviteEmail("");
      await loadFamily();
      showSuccess(`Invitation sent to ${email}.`);
    } catch (err) {
      console.error("Unexpected invitation error:", err);
      showError("Something went wrong while sending the invitation.");
    } finally {
      setSendingInvite(false);
    }
  }

  // ============================================================
  // Derived data
  // ============================================================

  const memberMeta = useMemo(() => {
    const map: Record<string, MemberMeta> = {};
    members.forEach((member, i) => {
      const isMe = member.user_id === userId;
      const name = member.username ? `@${member.username}` : member.display_name;
      map[member.user_id] = {
        isMe,
        name,
        label: isMe ? "You" : name,
        avatarUrl: member.avatar_url,
        color: MEMBER_COLORS[i % MEMBER_COLORS.length],
      };
    });
    return map;
  }, [members, userId]);

  const metaFor = (id: string) => memberMeta[id] || FALLBACK_META;

  const me = userId ? memberMeta[userId] : undefined;
  const myProfileIncomplete =
    !!userId && !members.find((m) => m.user_id === userId)?.username;

  const bookCountByOwner = useMemo(() => {
    const counts: Record<string, number> = {};
    books.forEach((b) => {
      counts[b.user_id] = (counts[b.user_id] || 0) + 1;
    });
    return counts;
  }, [books]);

  const searchTerm = search.trim().toLowerCase();

  const filteredBooks = books.filter((book) => {
    const matchesOwner = ownerFilter === "all" || book.user_id === ownerFilter;
    const matchesStatus = statusFilter === "all" || book.status === statusFilter;
    const matchesSearch =
      !searchTerm ||
      book.title.toLowerCase().includes(searchTerm) ||
      (book.author || "").toLowerCase().includes(searchTerm);
    return matchesOwner && matchesStatus && matchesSearch;
  });

  function coverSources(book: Book) {
    const sources: string[] = [];
    if (book.custom_cover_path && signedCovers[book.custom_cover_path]) {
      sources.push(signedCovers[book.custom_cover_path]);
    }
    if (book.cover_url) sources.push(book.cover_url);
    return sources;
  }

  // ============================================================
  // Loading
  // ============================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
        <FontStyles />
        <Navbar isLoggedIn={!!userId} />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12" aria-busy="true" aria-label="Loading your family">
          <div className="animate-pulse">
            <div className="h-4 w-32 bg-slate-900/10 rounded-full mb-5" />
            <div className="h-12 w-72 bg-slate-900/10 rounded-xl mb-12" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-slate-900/10" />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ============================================================
  // No family yet
  // ============================================================

  if (!family) {
    return (
      <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a] relative overflow-x-clip">
        <FontStyles />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[480px] bg-[#d8d0e3]/25 rounded-full blur-[120px] -z-10 pointer-events-none" />

        <Navbar isLoggedIn={!!userId} />

        <section className="max-w-2xl mx-auto px-5 sm:px-8 py-12 sm:py-20">
          <div className="text-center mb-10">
            <div className="flex justify-center -space-x-3 mb-7" aria-hidden="true">
              {MEMBER_COLORS.slice(0, 4).map((color, i) => (
                <span
                  key={color}
                  className="w-12 h-16 rounded-md shadow-md ring-2 ring-[#Fdfaf3]"
                  style={{ backgroundColor: color, transform: `rotate(${(i - 1.5) * 6}deg)` }}
                />
              ))}
            </div>

            <h1 className="font-classical text-4xl sm:text-5xl font-semibold leading-tight">
              Start a family library
            </h1>

            <p className="text-slate-600 max-w-lg mx-auto leading-7 mt-5 font-light text-lg">
              Everyone keeps their own shelves. Together, you can see every book the family owns.
            </p>
          </div>

          <form
            onSubmit={createFamily}
            className="bg-white rounded-3xl shadow-[0_15px_45px_rgba(15,23,42,0.06)] border border-[#0f172a]/5 p-6 sm:p-9"
          >
            <label htmlFor="family-name" className="block text-sm font-medium text-slate-700 mb-2">
              Family name
            </label>

            <input
              id="family-name"
              type="text"
              value={familyName}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="The Otieno Family"
              className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15 transition-all"
            />

            <p className="text-xs text-slate-400 mt-2">You can invite people once it&apos;s created.</p>

            <div className="mt-5" aria-live="polite">
              <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
            </div>

            <button
              type="submit"
              disabled={creatingFamily}
              className={`mt-6 w-full h-12 rounded-full bg-[#0f172a] text-[#Fdfaf3] font-medium hover:bg-[#7a947c] transition-colors disabled:opacity-50 disabled:cursor-wait inline-flex items-center justify-center gap-2 ${focusRing}`}
            >
              {creatingFamily && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {creatingFamily ? "Creating family…" : "Create family"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  // ============================================================
  // Family library
  // ============================================================

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a] relative overflow-x-clip">
      <FontStyles />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />
      <div className="absolute top-[520px] -right-40 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={!!userId} />

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-6 sm:pt-10 pb-24">
        {/* ---------------- Header ---------------- */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 pb-10 mb-10 border-b border-[#0f172a]/8">
          <div>
            <p className="text-sm text-[#7a947c] font-medium mb-3">Family library</p>
            <h1 className="font-classical text-4xl sm:text-5xl md:text-6xl font-semibold leading-[1.05]">
              {family.name}
            </h1>
            <p className="text-slate-500 mt-4">
              {books.length} {books.length === 1 ? "book" : "books"} across {members.length}{" "}
              {members.length === 1 ? "shelf" : "shelves"}
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3">
            <ul className="flex -space-x-2" aria-label="Family members">
              {members.map((member) => {
                const meta = metaFor(member.user_id);
                const fullLabel = meta.isMe ? `${meta.name} (you)` : meta.name;
                return (
                  <li key={member.user_id} title={fullLabel}>
                    <Avatar name={meta.name} color={meta.color} imageUrl={meta.avatarUrl} size="lg" ring />
                    <span className="sr-only">{fullLabel}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </header>

        {myProfileIncomplete && (
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 rounded-2xl bg-[#f6ecd4]/60 border border-[#c5a24a]/25 text-sm text-[#7a5d1c]">
            <p className="flex-1">Add a username and picture so your family can tell your books apart.</p>
            <Link
              href="/profile"
              className={`shrink-0 h-9 px-4 inline-flex items-center rounded-full bg-[#0f172a] text-[#Fdfaf3] text-xs font-medium hover:bg-[#7a947c] transition-colors ${focusRing}`}
            >
              Set up profile
            </Link>
          </div>
        )}

        <div className="mb-8" aria-live="polite">
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-10 lg:gap-12 items-start">
          {/* ================= Shared library ================= */}
          <div className="min-w-0">
            <h2 className="font-classical text-3xl font-semibold mb-6">Shared shelves</h2>

            {/* Owner filter */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4" role="group" aria-label="Show books from">
              <button
                type="button"
                onClick={() => setOwnerFilter("all")}
                aria-pressed={ownerFilter === "all"}
                className={`shrink-0 h-10 pl-4 pr-3 rounded-full text-sm inline-flex items-center gap-2 border transition-all ${focusRing} ${
                  ownerFilter === "all"
                    ? "bg-[#0f172a] text-[#Fdfaf3] border-[#0f172a]"
                    : "bg-white text-slate-600 border-slate-200 hover:border-[#7a947c]"
                }`}
              >
                Everyone
                <span className={`text-xs px-1.5 rounded-full ${ownerFilter === "all" ? "bg-white/15" : "bg-slate-100"}`}>
                  {books.length}
                </span>
              </button>

              {members.map((member) => {
                const meta = metaFor(member.user_id);
                const active = ownerFilter === member.user_id;
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => setOwnerFilter(member.user_id)}
                    aria-pressed={active}
                    className={`shrink-0 h-10 pl-1.5 pr-3 rounded-full text-sm inline-flex items-center gap-2 border transition-all ${focusRing} ${
                      active
                        ? "bg-[#0f172a] text-[#Fdfaf3] border-[#0f172a]"
                        : "bg-white text-slate-600 border-slate-200 hover:border-[#7a947c]"
                    }`}
                  >
                    <Avatar name={meta.name} color={meta.color} imageUrl={meta.avatarUrl} size="sm" />
                    {meta.label}
                    <span className={`text-xs px-1.5 rounded-full ${active ? "bg-white/15" : "bg-slate-100"}`}>
                      {bookCountByOwner[member.user_id] || 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search + status */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <div className="flex-1">
                <label htmlFor="family-search" className="sr-only">
                  Search the family library
                </label>
                <input
                  id="family-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title or author"
                  className="w-full h-11 px-5 bg-white border border-slate-200 rounded-full text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15 transition-all"
                />
              </div>

              <div>
                <label htmlFor="status-filter" className="sr-only">
                  Filter by reading status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full sm:w-auto h-11 px-4 pr-9 bg-white border border-slate-200 rounded-full text-sm text-slate-700 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15 transition-all"
                >
                  {STATUS_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="sr-only" aria-live="polite">
              {filteredBooks.length} {filteredBooks.length === 1 ? "book" : "books"} shown
            </p>

            {/* Grid */}
            {filteredBooks.length === 0 ? (
              <div className="bg-white/70 border border-dashed border-[#0f172a]/12 rounded-3xl p-10 sm:p-14 text-center">
                <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#d8d0e3]/40 flex items-center justify-center">
                  <span className="font-classical text-2xl">A</span>
                </div>
                <h3 className="font-classical text-2xl font-semibold">
                  {books.length === 0 ? "The shelves are empty" : "No books match"}
                </h3>
                <p className="text-slate-500 text-sm max-w-sm mx-auto mt-2 leading-6">
                  {books.length === 0
                    ? "Books anyone in the family adds to their library will show up here."
                    : "Change the search, pick another person, or choose a different status."}
                </p>
                {books.length === 0 ? (
                  <Link
                    href="/library"
                    className={`inline-flex mt-6 h-11 px-6 items-center rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors ${focusRing}`}
                  >
                    Add a book to your library
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setOwnerFilter("all");
                      setStatusFilter("all");
                    }}
                    className={`mt-6 text-sm font-medium text-[#7a947c] hover:text-[#0f172a] underline underline-offset-4 rounded ${focusRing}`}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-9">
                {filteredBooks.map((book) => {
                  const meta = metaFor(book.user_id);

                  const card = (
                    <>
                      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#e9e4d9] shadow-md group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300">
                        <CoverImage sources={coverSources(book)} title={book.title} author={book.author} />

                        <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] inline-flex items-center gap-1.5 pl-0.5 pr-2.5 py-0.5 rounded-full bg-[#Fdfaf3]/95 text-[11px] font-medium text-[#0f172a] shadow-sm">
                          <Avatar name={meta.name} color={meta.color} imageUrl={meta.avatarUrl} size="sm" />
                          <span className="truncate">{meta.label}</span>
                        </span>
                      </div>

                      <div className="mt-3.5">
                        <h3 className="font-classical font-semibold text-[17px] leading-snug line-clamp-2">
                          {book.title}
                        </h3>
                        {book.author && (
                          <p className="text-sm text-slate-500 mt-1 line-clamp-1">{book.author}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-2">{statusLabel(book.status)}</p>
                      </div>
                    </>
                  );

                  return (
                    <li key={book.id}>
                      {meta.isMe ? (
                        <Link
                          href={`/library/${book.id}`}
                          className={`group block rounded-xl ${focusRing}`}
                          aria-label={`${book.title}, your book. Open journal and review.`}
                        >
                          {card}
                        </Link>
                      ) : (
                        <div className="group" aria-label={`${book.title}, owned by ${meta.name}`}>
                          {card}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ================= Sidebar ================= */}
          <aside className="space-y-6 lg:sticky lg:top-28">
            {/* Members */}
            <section
              aria-labelledby="members-heading"
              className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-6"
            >
              <h2 id="members-heading" className="font-classical text-2xl font-semibold mb-5">
                Members
              </h2>

              <ul className="space-y-1">
                {members.map((member) => {
                  const meta = metaFor(member.user_id);
                  const count = bookCountByOwner[member.user_id] || 0;
                  return (
                    <li key={member.user_id}>
                      <button
                        type="button"
                        onClick={() =>
                          setOwnerFilter((current) => (current === member.user_id ? "all" : member.user_id))
                        }
                        aria-pressed={ownerFilter === member.user_id}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-colors ${focusRing} ${
                          ownerFilter === member.user_id ? "bg-[#Fdfaf3]" : "hover:bg-[#Fdfaf3]"
                        }`}
                      >
                        <Avatar name={meta.name} color={meta.color} imageUrl={meta.avatarUrl} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{meta.name}</span>
                            {meta.isMe && (
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#d8d0e3]/60 text-[#0f172a]">
                                You
                              </span>
                            )}
                            {member.user_id === family.created_by && (
                              <span className="shrink-0 text-[11px] text-[#7a947c]">Founder</span>
                            )}
                          </span>
                          <span className="block text-xs text-slate-400">
                            Joined {formatDate(member.joined_at)}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">
                          {count} {count === 1 ? "book" : "books"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Invite */}
            <section
              aria-labelledby="invite-heading"
              className="bg-[#0f172a] text-[#Fdfaf3] rounded-3xl shadow-[0_15px_45px_rgba(15,23,42,0.18)] p-6"
            >
              <h2 id="invite-heading" className="font-classical text-2xl font-semibold">
                Invite someone
              </h2>
              <p className="text-sm text-slate-300 leading-6 mt-2 mb-5">
                They keep their own library. Their books join these shelves once they accept.
              </p>

              <form onSubmit={sendInvite} className="space-y-3">
                <label htmlFor="invite-email" className="sr-only">
                  Email address to invite
                </label>
                <input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full h-12 px-4 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/25 transition-all"
                />
                <button
                  type="submit"
                  disabled={sendingInvite}
                  className="w-full h-12 rounded-full bg-[#7a947c] text-white font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-50 disabled:cursor-wait inline-flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[#Fdfaf3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f172a]"
                >
                  {sendingInvite && (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {sendingInvite ? "Sending invitation…" : "Send invitation"}
                </button>
              </form>

              {invites.length > 0 && (
                <div className="mt-6 pt-5 border-t border-white/10">
                  <h3 className="text-sm text-slate-300 mb-3">
                    Waiting to join ({invites.length})
                  </h3>
                  <ul className="space-y-2.5">
                    {invites.map((invite) => (
                      <li key={invite.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-slate-100">{invite.invited_email}</span>
                        <span className="shrink-0 text-xs text-[#d8d0e3]">
                          Expires {formatDate(invite.expires_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}