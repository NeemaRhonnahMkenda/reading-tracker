"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

// ============================================================
// Config
// ============================================================

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,30}$/;

type Notice = { type: "error" | "success"; message: string } | null;

// ============================================================
// Helpers
// ============================================================

// Check the real file type from magic bytes instead of trusting file.type
async function sniffImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

function validateUsername(value: string): string | null {
  if (value.length < 3) return "Use at least 3 characters.";
  if (value.length > 30) return "Use 30 characters or fewer.";
  if (!USERNAME_PATTERN.test(value)) {
    return "Use only letters, numbers, underscores, dots and hyphens.";
  }
  return null;
}

function passwordChecks(password: string) {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "A letter and a number", met: /[a-zA-Z]/.test(password) && /\d/.test(password) },
    { label: "A symbol or 12+ characters", met: /[^a-zA-Z0-9]/.test(password) || password.length >= 12 },
  ];
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const inputBase =
  "w-full h-12 px-4 rounded-xl border bg-[#Fdfaf3] text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:ring-4 transition-all";

// ============================================================
// Small components
// ============================================================

function InlineNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const isError = notice.type === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm ${
        isError ? "bg-[#f8e9e5] text-[#a14e43]" : "bg-[#eef3ee] text-[#4a5c4b]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0 ${
          isError ? "bg-[#c0675b]" : "bg-[#7a947c]"
        }`}
      >
        {isError ? "!" : "✓"}
      </span>
      <p className="leading-6">{notice.message}</p>
    </div>
  );
}

function Spinner({ light = true }: { light?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-4 h-4 border-2 rounded-full animate-spin ${
        light ? "border-white/30 border-t-white" : "border-[#0f172a]/20 border-t-[#0f172a]"
      }`}
    />
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${inputBase} pr-20 ${
            invalid
              ? "border-[#e0a79d] focus:border-[#c0675b] focus:ring-[#c0675b]/10"
              : "border-slate-200 focus:border-[#7a947c] focus:ring-[#7a947c]/15"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 px-3 rounded-lg text-xs font-medium text-slate-500 hover:text-[#0f172a] hover:bg-slate-100 transition-colors ${focusRing}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Profile
  const [savedUsername, setSavedUsername] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null);

  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameNotice, setUsernameNotice] = useState<Notice>(null);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<Notice>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  const [signingOut, setSigningOut] = useState(false);

  // ============================================================
  // Load
  // ============================================================

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setLoadError("");

      try {
        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !authUser) {
          router.push("/login");
          return;
        }

        if (!active) return;
        setUser(authUser);

        // No row yet is normal for first-time users: maybeSingle returns null
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("username, avatar_url, created_at")
          .eq("id", authUser.id)
          .maybeSingle();

        if (profileError) {
          console.error("Profile load failed:", profileError.message);
          setLoadError("Your profile details couldn't be loaded. Refresh to try again.");
          return;
        }

        if (profile && active) {
          setSavedUsername(profile.username || "");
          setUsername(profile.username || "");
          setAvatarUrl(profile.avatar_url || null);
          setProfileCreatedAt(profile.created_at || null);
        }
      } catch (err) {
        console.error("Unexpected profile error:", err);
        setLoadError("Something went wrong while loading your profile.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [router]);

  // ============================================================
  // Derived
  // ============================================================

  const trimmedUsername = username.trim();
  const usernameChanged = trimmedUsername !== savedUsername;
  const usernameError = trimmedUsername ? validateUsername(trimmedUsername) : null;

  const isEmailUser = useMemo(() => {
    const providers = (user?.app_metadata?.providers as string[] | undefined) || [
      user?.app_metadata?.provider as string,
    ];
    return providers.includes("email");
  }, [user]);

  const checks = passwordChecks(newPassword);
  const strength = checks.filter((c) => c.met).length;
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const displayName = savedUsername ? `@${savedUsername}` : user?.email?.split("@")[0] || "Reader";

  const initials = (savedUsername || user?.email || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

  const memberSince = formatDate(profileCreatedAt || user?.created_at);

  // ============================================================
  // Save username (creates the profile row on first save)
  // ============================================================

  async function saveUsername(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setUsernameNotice(null);

    const validation = validateUsername(trimmedUsername);
    if (validation) {
      setUsernameNotice({ type: "error", message: validation });
      return;
    }

    if (!usernameChanged) return;

    setSavingUsername(true);

    try {
      // Upsert only the columns being changed so avatar_url is left alone
      const { error } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, username: trimmedUsername, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );

      if (error) {
        console.error("Username save failed:", error.message);
        setUsernameNotice({
          type: "error",
          message:
            error.code === "23505"
              ? `@${trimmedUsername} is taken. Try another username.`
              : "Your username couldn't be saved. Try again.",
        });
        return;
      }

      setSavedUsername(trimmedUsername);
      setUsername(trimmedUsername);
      if (!profileCreatedAt) setProfileCreatedAt(new Date().toISOString());
      setUsernameNotice({ type: "success", message: `Username saved. Your family will see @${trimmedUsername}.` });
    } finally {
      setSavingUsername(false);
    }
  }

  // ============================================================
  // Upload avatar: upload new → save profile → remove old files
  // ============================================================

  async function handleAvatarSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;

    setAvatarNotice(null);

    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarNotice({ type: "error", message: "That image is over 5 MB. Choose a smaller one." });
      return;
    }

    const realType = await sniffImageType(file);
    if (!realType || !ALLOWED_AVATAR_TYPES[realType]) {
      setAvatarNotice({ type: "error", message: "Use a JPG, PNG or WebP image." });
      return;
    }

    setUploadingAvatar(true);

    const fileName = `${crypto.randomUUID()}.${ALLOWED_AVATAR_TYPES[realType]}`;
    const filePath = `${user.id}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, file, { contentType: realType, cacheControl: "3600", upsert: false });

      if (uploadError) {
        console.error("Avatar upload failed:", uploadError.message);
        setAvatarNotice({ type: "error", message: "Your picture didn't upload. Try again." });
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, avatar_url: publicUrl, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );

      if (profileError) {
        console.error("Avatar profile update failed:", profileError.message);
        await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
        setAvatarNotice({ type: "error", message: "Your picture couldn't be saved to your profile. Try again." });
        return;
      }

      // Clean up older avatars only after the new one is live
      const { data: existing } = await supabase.storage.from(AVATAR_BUCKET).list(user.id);
      const stale = (existing || [])
        .filter((f) => f.name !== fileName)
        .map((f) => `${user.id}/${f.name}`);
      if (stale.length > 0) {
        const { error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove(stale);
        if (cleanupError) console.error("Old avatar cleanup failed:", cleanupError.message);
      }

      setAvatarUrl(publicUrl);
      setAvatarFailed(false);
      if (!profileCreatedAt) setProfileCreatedAt(new Date().toISOString());
      setAvatarNotice({ type: "success", message: "Profile picture updated." });
    } catch (err) {
      console.error("Unexpected avatar error:", err);
      setAvatarNotice({ type: "error", message: "Something went wrong while uploading your picture." });
    } finally {
      setUploadingAvatar(false);
    }
  }

  // ============================================================
  // Remove avatar: clear profile first, then delete files
  // ============================================================

  async function removeAvatar() {
    if (!user || !avatarUrl) return;

    const confirmed = window.confirm("Remove your profile picture?");
    if (!confirmed) return;

    setUploadingAvatar(true);
    setAvatarNotice(null);

    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: null, updated_at: new Date().toISOString() })
        .eq("id", user.id);

      if (profileError) {
        console.error("Avatar removal failed:", profileError.message);
        setAvatarNotice({ type: "error", message: "Your picture couldn't be removed. Try again." });
        return;
      }

      const { data: existing } = await supabase.storage.from(AVATAR_BUCKET).list(user.id);
      const paths = (existing || []).map((f) => `${user.id}/${f.name}`);
      if (paths.length > 0) {
        const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove(paths);
        if (removeError) console.error("Avatar file cleanup failed:", removeError.message);
      }

      setAvatarUrl(null);
      setAvatarNotice({ type: "success", message: "Profile picture removed." });
    } finally {
      setUploadingAvatar(false);
    }
  }

  // ============================================================
  // Change password (Supabase Auth, not the profiles table)
  // ============================================================

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordNotice(null);

    if (!user?.email) {
      setPasswordNotice({ type: "error", message: "We couldn't find the email for your account." });
      return;
    }
    if (!currentPassword) {
      setPasswordNotice({ type: "error", message: "Enter your current password." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordNotice({ type: "error", message: "Your new password needs at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordNotice({ type: "error", message: "The new passwords don't match." });
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordNotice({ type: "error", message: "Choose a password that's different from your current one." });
      return;
    }

    setChangingPassword(true);

    try {
      // Re-verify the current password before allowing a change
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyError) {
        setPasswordNotice({ type: "error", message: "Your current password is incorrect." });
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

      if (updateError) {
        console.error("Password update failed:", updateError.message);

        const code = (updateError as { code?: string }).code;
        let message = "Your password couldn't be changed. Try again.";
        if (code === "weak_password") message = "That password is too weak. Make it longer or add more variety.";
        if (code === "same_password") message = "Choose a password that's different from your current one.";
        if (code === "reauthentication_needed") message = "For security, sign out and back in, then try again.";

        setPasswordNotice({ type: "error", message });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice({ type: "success", message: "Password changed. Use it next time you sign in." });
    } catch (err) {
      console.error("Unexpected password error:", err);
      setPasswordNotice({ type: "error", message: "Something went wrong while changing your password." });
    } finally {
      setChangingPassword(false);
    }
  }

  // ============================================================
  // Sign out
  // ============================================================

  async function signOut() {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out failed:", error.message);
      setSigningOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  // ============================================================
  // Loading
  // ============================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
        <FontStyles />
        <Navbar isLoggedIn />
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-12" aria-busy="true" aria-label="Loading your profile">
          <div className="animate-pulse grid lg:grid-cols-[300px_1fr] gap-8">
            <div className="h-80 rounded-3xl bg-slate-900/[0.06]" />
            <div className="space-y-6">
              <div className="h-64 rounded-3xl bg-slate-900/[0.06]" />
              <div className="h-80 rounded-3xl bg-slate-900/[0.06]" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ============================================================
  // Page
  // ============================================================

  const showAvatarImage = avatarUrl && !avatarFailed;

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a] relative overflow-x-clip">
      <FontStyles />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[480px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={!!user} />

      <section className="max-w-5xl mx-auto px-5 sm:px-8 pt-6 sm:pt-10 pb-24">
        <header className="mb-10">
          <h1 className="font-classical text-4xl sm:text-5xl font-semibold">Profile</h1>
          <p className="text-slate-500 mt-3 max-w-xl leading-7">
            Choose how your family sees you, and keep your account secure.
          </p>
        </header>

        {loadError && (
          <div className="mb-8">
            <InlineNotice notice={{ type: "error", message: loadError }} />
          </div>
        )}

        <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
          {/* ================= Identity card ================= */}
          <aside className="lg:sticky lg:top-28">
            <div className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_15px_45px_rgba(15,23,42,0.06)] overflow-hidden">
              <div className="h-20 bg-gradient-to-br from-[#d8d0e3] to-[#c9d6c9]" aria-hidden="true" />

              <div className="px-6 pb-6 -mt-12 text-center">
                <div className="relative inline-block">
                  <div className="w-24 h-24 rounded-full ring-4 ring-white shadow-md overflow-hidden bg-[#0f172a] flex items-center justify-center">
                    {showAvatarImage ? (
                      <img
                        src={avatarUrl!}
                        alt="Your profile picture"
                        className="w-full h-full object-cover"
                        onError={() => setAvatarFailed(true)}
                      />
                    ) : (
                      <span className="font-classical text-3xl text-[#Fdfaf3]" aria-hidden="true">
                        {initials}
                      </span>
                    )}

                    {uploadingAvatar && (
                      <span className="absolute inset-0 rounded-full bg-[#0f172a]/50 flex items-center justify-center">
                        <Spinner />
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    aria-label={avatarUrl ? "Change profile picture" : "Add profile picture"}
                    className={`absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-[#7a947c] text-white ring-4 ring-white flex items-center justify-center hover:bg-[#6b826c] transition-colors disabled:opacity-60 ${focusRing}`}
                  >
                    <CameraIcon />
                  </button>
                </div>

                <p className="font-classical text-2xl font-semibold mt-4 break-words">{displayName}</p>
                <p className="text-sm text-slate-500 mt-1 break-all">{user?.email}</p>

                {!savedUsername && (
                  <p className="mt-4 text-xs px-3 py-2 rounded-xl bg-[#f6ecd4]/70 text-[#8a6a22]">
                    Pick a username so your family knows it&apos;s you.
                  </p>
                )}
              </div>

              <dl className="border-t border-[#0f172a]/5 px-6 py-5 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Member since</dt>
                  <dd className="text-slate-700 text-right">{memberSince}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Sign-in method</dt>
                  <dd className="text-slate-700 text-right">{isEmailUser ? "Email and password" : "Social sign-in"}</dd>
                </div>
              </dl>
            </div>
          </aside>

          {/* ================= Settings ================= */}
          <div className="space-y-6 min-w-0">
            {/* ---------- Public profile ---------- */}
            <section
              aria-labelledby="public-profile-heading"
              className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-6 sm:p-8"
            >
              <h2 id="public-profile-heading" className="font-classical text-2xl font-semibold">
                Public profile
              </h2>
              <p className="text-sm text-slate-500 mt-1.5">Family members see your picture and username.</p>

              {/* Picture */}
              <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-5 p-4 sm:p-5 rounded-2xl bg-[#Fdfaf3]">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-[#0f172a] flex items-center justify-center shrink-0">
                  {showAvatarImage ? (
                    <img src={avatarUrl!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-classical text-xl text-[#Fdfaf3]" aria-hidden="true">
                      {initials}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700">Profile picture</p>
                  <p className="text-xs text-slate-400 mt-0.5">JPG, PNG or WebP, up to 5 MB. Square images look best.</p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    id="avatar-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarSelected}
                    className="sr-only"
                    tabIndex={-1}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className={`h-10 px-4 rounded-full bg-[#0f172a] text-white text-sm font-medium hover:bg-[#7a947c] transition-colors disabled:opacity-50 inline-flex items-center gap-2 ${focusRing}`}
                  >
                    {uploadingAvatar && <Spinner />}
                    {uploadingAvatar ? "Uploading…" : avatarUrl ? "Change" : "Upload"}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={removeAvatar}
                      disabled={uploadingAvatar}
                      className={`h-10 px-4 rounded-full border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:border-[#c0675b] hover:text-[#a14e43] transition-colors disabled:opacity-50 ${focusRing}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {avatarNotice && (
                <div className="mt-4" aria-live="polite">
                  <InlineNotice notice={avatarNotice} />
                </div>
              )}

              {/* Username */}
              <form onSubmit={saveUsername} className="mt-7" noValidate>
                <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
                  Username
                </label>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <span
                      aria-hidden="true"
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a947c] font-medium"
                    >
                      @
                    </span>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setUsernameNotice(null);
                      }}
                      placeholder="yourname"
                      maxLength={30}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-describedby="username-help"
                      aria-invalid={!!usernameError || undefined}
                      className={`${inputBase} pl-9 ${
                        usernameError
                          ? "border-[#e0a79d] focus:border-[#c0675b] focus:ring-[#c0675b]/10"
                          : "border-slate-200 focus:border-[#7a947c] focus:ring-[#7a947c]/15"
                      }`}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingUsername || !usernameChanged || !!usernameError || !trimmedUsername}
                    className={`h-12 px-6 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${focusRing}`}
                  >
                    {savingUsername && <Spinner />}
                    {savingUsername ? "Saving…" : savedUsername ? "Save username" : "Create profile"}
                  </button>
                </div>

                <div id="username-help" className="flex items-start justify-between gap-4 mt-2">
                  <p className={`text-xs leading-5 ${usernameError ? "text-[#a14e43]" : "text-slate-400"}`}>
                    {usernameError || "3 to 30 characters: letters, numbers, underscores, dots and hyphens."}
                  </p>
                  <span className="text-xs text-slate-400 tabular-nums shrink-0">{username.length}/30</span>
                </div>

                {usernameNotice && (
                  <div className="mt-4" aria-live="polite">
                    <InlineNotice notice={usernameNotice} />
                  </div>
                )}
              </form>
            </section>

            {/* ---------- Password ---------- */}
            <section
              aria-labelledby="password-heading"
              className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-6 sm:p-8"
            >
              <h2 id="password-heading" className="font-classical text-2xl font-semibold">
                Password
              </h2>

              {!isEmailUser ? (
                <p className="text-sm text-slate-500 mt-3 leading-6">
                  You sign in with a social account, so there&apos;s no password to change here. Manage it with that
                  provider instead.
                </p>
              ) : (
                <form onSubmit={changePassword} className="mt-6 space-y-5" noValidate>
                  {/* Hidden username field helps password managers pair the new password with this account */}
                  <input type="email" value={user?.email || ""} autoComplete="username" readOnly hidden />

                  <PasswordInput
                    id="current-password"
                    label="Current password"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete="current-password"
                  />

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <PasswordInput
                        id="new-password"
                        label="New password"
                        value={newPassword}
                        onChange={setNewPassword}
                        autoComplete="new-password"
                        describedBy="password-rules"
                      />
                    </div>
                    <div>
                      <PasswordInput
                        id="confirm-password"
                        label="Confirm new password"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        autoComplete="new-password"
                        describedBy="password-match"
                        invalid={passwordMismatch}
                      />
                      <p
                        id="password-match"
                        aria-live="polite"
                        className={`text-xs mt-2 min-h-[1rem] ${
                          passwordMismatch ? "text-[#a14e43]" : passwordsMatch ? "text-[#4a5c4b]" : "text-slate-400"
                        }`}
                      >
                        {passwordMismatch ? "Passwords don't match" : passwordsMatch ? "Passwords match" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Strength */}
                  <div id="password-rules">
                    <div className="flex gap-1.5" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            newPassword && i < strength
                              ? strength === 1
                                ? "bg-[#c0675b]"
                                : strength === 2
                                ? "bg-[#c5a24a]"
                                : "bg-[#7a947c]"
                              : "bg-slate-100"
                          }`}
                        />
                      ))}
                    </div>
                    <ul className="mt-3 grid sm:grid-cols-3 gap-2">
                      {checks.map((check) => (
                        <li
                          key={check.label}
                          className={`flex items-center gap-2 text-xs ${check.met ? "text-[#4a5c4b]" : "text-slate-400"}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                              check.met ? "bg-[#7a947c] text-white" : "bg-slate-100"
                            }`}
                          >
                            {check.met ? "✓" : ""}
                          </span>
                          <span>
                            {check.label}
                            <span className="sr-only">{check.met ? " (met)" : " (not met)"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {passwordNotice && (
                    <div aria-live="polite">
                      <InlineNotice notice={passwordNotice} />
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                      className={`h-12 px-6 rounded-full bg-[#0f172a] text-white text-sm font-medium hover:bg-[#1e293b] transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 w-full sm:w-auto ${focusRing}`}
                    >
                      {changingPassword && <Spinner />}
                      {changingPassword ? "Changing password…" : "Change password"}
                    </button>
                  </div>
                </form>
              )}
            </section>

            {/* ---------- Session ---------- */}
            <section
              aria-labelledby="session-heading"
              className="rounded-3xl border border-[#0f172a]/8 bg-white/60 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5"
            >
              <div>
                <h2 id="session-heading" className="font-classical text-2xl font-semibold">
                  Sign out
                </h2>
                <p className="text-sm text-slate-500 mt-1.5">End your session on this device.</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className={`shrink-0 h-11 px-6 rounded-full border border-[#e0a79d] bg-white text-[#a14e43] text-sm font-medium hover:bg-[#f8e9e5] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 ${focusRing}`}
              >
                {signingOut && <Spinner light={false} />}
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
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

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}