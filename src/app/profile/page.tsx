"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

export default function ProfilePage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [user, setUser] = useState<any>(null);
    const [username, setUsername] = useState("");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [savingProfile, setSavingProfile] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    // ============================================================
    // LOAD PROFILE
    // ============================================================

    useEffect(() => {
        loadProfile();
    }, []);

    async function loadProfile() {
        setLoading(true);
        setError("");

        try {
            const {
                data: { user },
                error: authError,
            } = await supabase.auth.getUser();

            if (authError || !user) {
                router.push("/login");
                return;
            }

            setUser(user);

            const { data: profile, error: profileError } =
                await supabase
                    .from("profiles")
                    .select("username, avatar_url")
                    .eq("id", user.id)
                    .maybeSingle();

            if (profileError) {
                console.error("Error loading profile:", profileError);
                setError("Could not load your profile.");
            } else if (profile) {
                setUsername(profile.username || "");
                setAvatarUrl(profile.avatar_url || null);
            }
        } catch (err) {
            console.error("Unexpected profile error:", err);
            setError("Something went wrong while loading your profile.");
        } finally {
            setLoading(false);
        }
    }

    // ============================================================
    // SAVE PROFILE
    // ============================================================

    async function saveProfile() {
        if (!user) return;

        setSavingProfile(true);
        setMessage("");
        setError("");

        const cleanedUsername = username.trim();

        if (cleanedUsername.length < 3) {
            setError("Username must be at least 3 characters.");
            setSavingProfile(false);
            return;
        }

        if (cleanedUsername.length > 30) {
            setError("Username must be 30 characters or less.");
            setSavingProfile(false);
            return;
        }

        if (!/^[a-zA-Z0-9_.-]+$/.test(cleanedUsername)) {
            setError(
                "Username can only contain letters, numbers, underscores, dots and hyphens."
            );
            setSavingProfile(false);
            return;
        }

        const { error: updateError } = await supabase
            .from("profiles")
            .upsert({
                id: user.id,
                username: cleanedUsername,
                avatar_url: avatarUrl,
                updated_at: new Date().toISOString(),
            });

        if (updateError) {
            console.error("Profile update error:", updateError);

            if (updateError.code === "23505") {
                setError("That username is already taken.");
            } else {
                setError("Could not save your profile.");
            }

            setSavingProfile(false);
            return;
        }

        setUsername(cleanedUsername);
        setMessage("Profile updated successfully.");
        setSavingProfile(false);
    }

    // ============================================================
    // UPLOAD AVATAR
    // ============================================================

    async function uploadAvatar(
        event: React.ChangeEvent<HTMLInputElement>
    ) {
        const file = event.target.files?.[0];

        if (!file || !user) return;

        setUploadingAvatar(true);
        setMessage("");
        setError("");

        if (!file.type.startsWith("image/")) {
            setError("Please select an image file.");
            setUploadingAvatar(false);
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setError("Your profile picture must be smaller than 5MB.");
            setUploadingAvatar(false);
            return;
        }

        const fileExtension = file.name.split(".").pop() || "jpg";
        const filePath = `${user.id}/avatar.${fileExtension}`;

        const { data: existingFiles } = await supabase.storage
            .from("avatars")
            .list(user.id);

        if (existingFiles && existingFiles.length > 0) {
            const filesToRemove = existingFiles.map(
                (existingFile) => `${user.id}/${existingFile.name}`
            );

            await supabase.storage
                .from("avatars")
                .remove(filesToRemove);
        }

        const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(filePath, file, {
                upsert: true,
                cacheControl: "3600",
            });

        if (uploadError) {
            console.error("Avatar upload error:", uploadError);
            setError("Could not upload your profile picture.");
            setUploadingAvatar(false);
            return;
        }

        const {
            data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(filePath);

        const avatarWithCacheBuster = `${publicUrl}?t=${Date.now()}`;

        const { error: profileError } = await supabase
            .from("profiles")
            .upsert({
                id: user.id,
                username: username || null,
                avatar_url: avatarWithCacheBuster,
                updated_at: new Date().toISOString(),
            });

        if (profileError) {
            console.error(
                "Profile avatar update error:",
                profileError
            );

            setError(
                "Picture uploaded, but your profile could not be updated."
            );
            setUploadingAvatar(false);
            return;
        }

        setAvatarUrl(avatarWithCacheBuster);
        setMessage("Profile picture updated.");
        setUploadingAvatar(false);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }

    // ============================================================
    // REMOVE AVATAR
    // ============================================================

    async function removeAvatar() {
        if (!user) return;

        setUploadingAvatar(true);
        setMessage("");
        setError("");

        const { data: existingFiles } = await supabase.storage
            .from("avatars")
            .list(user.id);

        if (existingFiles && existingFiles.length > 0) {
            const filesToRemove = existingFiles.map(
                (existingFile) => `${user.id}/${existingFile.name}`
            );

            const { error: removeError } = await supabase.storage
                .from("avatars")
                .remove(filesToRemove);

            if (removeError) {
                console.error(
                    "Avatar removal error:",
                    removeError
                );
            }
        }

        const { error: profileError } = await supabase
            .from("profiles")
            .update({
                avatar_url: null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);

        if (profileError) {
            setError("Could not remove your profile picture.");
            setUploadingAvatar(false);
            return;
        }

        setAvatarUrl(null);
        setMessage("Profile picture removed.");
        setUploadingAvatar(false);
    }

    // ============================================================
    // CHANGE PASSWORD
    // ============================================================

    async function changePassword() {
        setMessage("");
        setError("");

        if (!currentPassword) {
            setError("Enter your current password.");
            return;
        }

        if (!newPassword) {
            setError("Enter a new password.");
            return;
        }

        if (newPassword.length < 8) {
            setError("Your new password must be at least 8 characters.");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("The new passwords do not match.");
            return;
        }

        if (currentPassword === newPassword) {
            setError(
                "Your new password must be different from your current password."
            );
            return;
        }

        setChangingPassword(true);

        try {
            if (!user?.email) {
                throw new Error("Could not determine your account email.");
            }

            const { error: signInError } =
                await supabase.auth.signInWithPassword({
                    email: user.email,
                    password: currentPassword,
                });

            if (signInError) {
                setError("Your current password is incorrect.");
                setChangingPassword(false);
                return;
            }

            const { error: updateError } =
                await supabase.auth.updateUser({
                    password: newPassword,
                });

            if (updateError) {
                console.error(
                    "Password update error:",
                    updateError
                );

                setError(
                    updateError.message ||
                        "Could not change your password."
                );

                setChangingPassword(false);
                return;
            }

            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");

            setMessage(
                "Your password has been changed successfully."
            );
        } catch (err) {
            console.error(err);
            setError(
                "Something went wrong while changing your password."
            );
        }

        setChangingPassword(false);
    }

    // ============================================================
    // SIGN OUT
    // ============================================================

    async function signOut() {
        await supabase.auth.signOut();
        router.push("/login");
    }

    // ============================================================
    // INITIALS
    // ============================================================

    function getInitials() {
        if (username) {
            return username
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
        }

        if (user?.email) {
            return user.email.charAt(0).toUpperCase();
        }

        return "?";
    }

    // ============================================================
    // LOADING
    // ============================================================

    if (loading) {
        return (
            <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
                <style jsx global>{`
                    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');

                    .font-classical {
                        font-family: "Playfair Display", serif;
                    }
                `}</style>

                <Navbar />

                <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
                    <div className="text-center">
                        <p className="text-slate-500">
                            Loading your profile...
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    // ============================================================
    // PAGE
    // ============================================================

    return (
        <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');

                .font-classical {
                    font-family: "Playfair Display", serif;
                }
            `}</style>

            <Navbar isLoggedIn={!!user} />

            <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-20">

                {/* ==================================================
                    HEADER
                ================================================== */}

                <div className="pt-6 sm:pt-10 pb-10">
                    <p className="text-sm uppercase tracking-[0.2em] text-[#7a947c] font-medium mb-3">
                        Your Account
                    </p>

                    <div>
                        <h1 className="font-classical text-4xl sm:text-5xl font-semibold mb-4">
                            Your Profile
                        </h1>

                        <p className="text-slate-500 max-w-2xl leading-relaxed">
                            Manage your profile, account details and
                            security settings for The Archive.
                        </p>
                    </div>
                </div>

                {/* ==================================================
                    MESSAGES
                ================================================== */}

                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {message && (
                    <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-100 text-green-700 text-sm">
                        {message}
                    </div>
                )}

                {/* ==================================================
                    PROFILE OVERVIEW
                ================================================== */}

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8 mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-6">

                        {/* Avatar */}

                        <div className="relative shrink-0">
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt="Profile picture"
                                    className="w-28 h-28 rounded-full object-cover border-4 border-[#d8d0e3] shadow-sm"
                                />
                            ) : (
                                <div className="w-28 h-28 rounded-full bg-[#d8d0e3] flex items-center justify-center border-4 border-[#d8d0e3]">
                                    <span className="font-classical text-4xl text-[#0f172a]">
                                        {getInitials()}
                                    </span>
                                </div>
                            )}

                            <div className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-[#7a947c] border-4 border-white" />
                        </div>

                        {/* Identity */}

                        <div className="min-w-0">
                            <p className="text-sm text-[#7a947c] uppercase tracking-wider mb-1">
                                Profile
                            </p>

                            <h2 className="font-classical text-3xl font-semibold">
                                {username
                                    ? `@${username}`
                                    : "Set up your profile"}
                            </h2>

                            <p className="text-slate-500 text-sm mt-2 break-all">
                                {user?.email}
                            </p>

                            <p className="text-slate-400 text-sm mt-3 max-w-xl">
                                This information helps your family
                                members recognise you around The
                                Archive.
                            </p>
                        </div>
                    </div>
                </div>

                {/* ==================================================
                    MAIN CONTENT
                ================================================== */}

                <div className="grid lg:grid-cols-[1fr_1.25fr] gap-6">

                    {/* ==================================================
                        LEFT COLUMN
                    ================================================== */}

                    <div className="space-y-6">

                        {/* PROFILE PICTURE */}

                        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">

                            <p className="text-sm text-[#7a947c] uppercase tracking-wider">
                                Appearance
                            </p>

                            <h2 className="font-classical text-2xl font-semibold mt-1">
                                Profile picture
                            </h2>

                            <p className="text-slate-500 text-sm leading-relaxed mt-3">
                                Add a picture so your family members
                                can recognise you.
                            </p>

                            <div className="flex flex-col items-center mt-8">

                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt="Profile picture"
                                        className="w-40 h-40 rounded-full object-cover border-4 border-[#d8d0e3] shadow-sm"
                                    />
                                ) : (
                                    <div className="w-40 h-40 rounded-full bg-[#d8d0e3] flex items-center justify-center border-4 border-[#d8d0e3]">
                                        <span className="font-classical text-5xl">
                                            {getInitials()}
                                        </span>
                                    </div>
                                )}

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={uploadAvatar}
                                    className="hidden"
                                />

                                <div className="flex flex-wrap justify-center gap-3 mt-6">

                                    <button
                                        type="button"
                                        onClick={() =>
                                            fileInputRef.current?.click()
                                        }
                                        disabled={uploadingAvatar}
                                        className="px-5 py-3 rounded-xl bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-50"
                                    >
                                        {uploadingAvatar
                                            ? "Uploading..."
                                            : avatarUrl
                                            ? "Change Picture"
                                            : "Add Picture"}
                                    </button>

                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={removeAvatar}
                                            disabled={uploadingAvatar}
                                            className="px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-[#Fdfaf3] transition-colors disabled:opacity-50"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>

                                <p className="text-xs text-slate-400 mt-5">
                                    JPG, PNG or WEBP · Maximum 5MB
                                </p>
                            </div>
                        </div>

                        {/* EMAIL */}

                        <div className="bg-[#0f172a] text-white rounded-3xl shadow-sm p-6 sm:p-8">

                            <p className="text-sm text-[#d8d0e3] uppercase tracking-wider">
                                Account
                            </p>

                            <h2 className="font-classical text-2xl font-semibold mt-1 mb-5">
                                Email address
                            </h2>

                            <div className="bg-white/10 border border-white/10 rounded-xl px-4 py-4">
                                <p className="text-xs text-slate-400 mb-1">
                                    Your account email
                                </p>

                                <p className="text-sm sm:text-base break-all">
                                    {user?.email}
                                </p>
                            </div>

                            <p className="text-slate-400 text-xs leading-relaxed mt-5">
                                Your email is managed through your
                                Archive account and cannot be changed
                                from this page.
                            </p>
                        </div>
                    </div>

                    {/* ==================================================
                        RIGHT COLUMN
                    ================================================== */}

                    <div className="space-y-6">

                        {/* USERNAME */}

                        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">

                            <div className="flex items-start justify-between gap-4">

                                <div>
                                    <p className="text-sm text-[#7a947c] uppercase tracking-wider">
                                        Identity
                                    </p>

                                    <h2 className="font-classical text-2xl font-semibold mt-1">
                                        Username
                                    </h2>
                                </div>

                                <span className="px-3 py-1.5 rounded-full bg-[#d8d0e3] text-[#0f172a] text-xs shrink-0">
                                    Public
                                </span>
                            </div>

                            <p className="text-slate-500 text-sm leading-relaxed mt-4">
                                Choose the name you want other family
                                members to see around The Archive.
                            </p>

                            <div className="mt-6">
                                <label className="block text-sm font-medium mb-2">
                                    Username
                                </label>

                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a947c] font-medium">
                                        @
                                    </span>

                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(event) =>
                                            setUsername(
                                                event.target.value
                                            )
                                        }
                                        placeholder="yourusername"
                                        maxLength={30}
                                        className="w-full px-4 py-3.5 pl-9 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] outline-none focus:border-[#7a947c] transition-colors"
                                    />
                                </div>

                                <div className="flex items-start justify-between gap-4 mt-3">
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        3–30 characters. Letters,
                                        numbers, underscores, dots and
                                        hyphens.
                                    </p>

                                    <span className="text-xs text-slate-400 whitespace-nowrap">
                                        {username.length}/30
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={saveProfile}
                                    disabled={savingProfile}
                                    className="mt-6 px-6 py-3.5 rounded-xl bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {savingProfile
                                        ? "Saving..."
                                        : "Save Profile"}
                                </button>
                            </div>
                        </div>

                        {/* PASSWORD */}

                        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">

                            <p className="text-sm text-[#7a947c] uppercase tracking-wider">
                                Security
                            </p>

                            <h2 className="font-classical text-2xl font-semibold mt-1">
                                Change password
                            </h2>

                            <p className="text-slate-500 text-sm leading-relaxed mt-3">
                                Update your password to keep your
                                Archive account secure.
                            </p>

                            <div className="space-y-5 mt-6">

                                {/* Current password */}

                                <div>
                                    <label className="block text-sm font-medium mb-2">
                                        Current password
                                    </label>

                                    <input
                                        type="password"
                                        value={currentPassword}
                                        onChange={(event) =>
                                            setCurrentPassword(
                                                event.target.value
                                            )
                                        }
                                        placeholder="Enter your current password"
                                        autoComplete="current-password"
                                        className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] outline-none focus:border-[#7a947c] transition-colors"
                                    />
                                </div>

                                {/* New password */}

                                <div>
                                    <label className="block text-sm font-medium mb-2">
                                        New password
                                    </label>

                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(event) =>
                                            setNewPassword(
                                                event.target.value
                                            )
                                        }
                                        placeholder="At least 8 characters"
                                        autoComplete="new-password"
                                        className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] outline-none focus:border-[#7a947c] transition-colors"
                                    />

                                    <div className="mt-2 flex items-center gap-2">
                                        <span
                                            className={`w-2 h-2 rounded-full ${
                                                newPassword.length >= 8
                                                    ? "bg-[#7a947c]"
                                                    : "bg-slate-200"
                                            }`}
                                        />

                                        <span className="text-xs text-slate-400">
                                            At least 8 characters
                                        </span>
                                    </div>
                                </div>

                                {/* Confirm password */}

                                <div>
                                    <label className="block text-sm font-medium mb-2">
                                        Confirm new password
                                    </label>

                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(event) =>
                                            setConfirmPassword(
                                                event.target.value
                                            )
                                        }
                                        placeholder="Repeat your new password"
                                        autoComplete="new-password"
                                        className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] outline-none focus:border-[#7a947c] transition-colors"
                                    />

                                    {confirmPassword && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span
                                                className={`w-2 h-2 rounded-full ${
                                                    newPassword ===
                                                    confirmPassword
                                                        ? "bg-[#7a947c]"
                                                        : "bg-red-400"
                                                }`}
                                            />

                                            <span
                                                className={`text-xs ${
                                                    newPassword ===
                                                    confirmPassword
                                                        ? "text-[#426047]"
                                                        : "text-red-500"
                                                }`}
                                            >
                                                {newPassword ===
                                                confirmPassword
                                                    ? "Passwords match"
                                                    : "Passwords do not match"}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={changePassword}
                                disabled={changingPassword}
                                className="mt-7 px-6 py-3.5 rounded-xl bg-[#0f172a] text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {changingPassword
                                    ? "Changing Password..."
                                    : "Change Password"}
                            </button>
                        </div>

                        {/* SIGN OUT */}

                        <div className="rounded-3xl border border-red-100 bg-red-50 p-6 sm:p-8">

                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">

                                <div>
                                    <p className="text-sm text-red-600 uppercase tracking-wider">
                                        Account
                                    </p>

                                    <h2 className="font-classical text-2xl font-semibold text-red-900 mt-1">
                                        Sign out
                                    </h2>

                                    <p className="text-red-700/70 text-sm mt-2">
                                        Sign out of The Archive on this
                                        device.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={signOut}
                                    className="shrink-0 px-5 py-3 rounded-xl border border-red-200 bg-white text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ==================================================
                    FOOTER
                ================================================== */}

                <footer className="mt-12 pt-7 border-t border-slate-200">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="font-classical text-sm text-[#7a947c]">
                            Your reading life, your way.
                        </p>

                        <p className="text-xs text-slate-400">
                            The Archive
                        </p>
                    </div>
                </footer>
            </section>
        </main>
    );
}