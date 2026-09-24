"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

interface Family {
    id: string;
    name: string;
    created_by: string;
    created_at: string;
}

interface FamilyMember {
    id: string;
    family_id: string;
    user_id: string;
    joined_at: string;
}

interface Book {
    id: string;
    user_id: string;
    title: string;
    author: string | null;
    cover_url: string | null;
    status: string | null;
    added_at: string | null;
}

interface FamilyBook extends Book {
    ownerEmail?: string;
}

interface FamilyInvite {
    id: string;
    invited_email: string;
    status: string;
    created_at: string;
    expires_at: string;
}

export default function FamilyPage() {
    const router = useRouter();

    const [userId, setUserId] = useState<string | null>(null);
    const [family, setFamily] = useState<Family | null>(null);
    const [members, setMembers] = useState<FamilyMember[]>([]);
    const [books, setBooks] = useState<FamilyBook[]>([]);
    const [invites, setInvites] = useState<FamilyInvite[]>([]);

    const [loading, setLoading] = useState(true);
    const [creatingFamily, setCreatingFamily] = useState(false);
    const [sendingInvite, setSendingInvite] = useState(false);

    const [familyName, setFamilyName] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    // ============================================================
    // LOAD FAMILY
    // ============================================================

    useEffect(() => {
        loadFamily();
    }, []);

    async function loadFamily() {
        setLoading(true);
        setError("");

        try {
            // --------------------------------------------------------
            // Get current authenticated session
            // --------------------------------------------------------

            const {
                data: { session },
                error: sessionError,
            } = await supabase.auth.getSession();

            if (sessionError) {
                console.error("Session error:", sessionError);

                setError("We couldn't verify your login session.");
                return;
            }

            if (!session?.user) {
                router.push("/login");
                return;
            }

            const currentUserId = session.user.id;

            setUserId(currentUserId);

            // --------------------------------------------------------
            // Find the current user's family membership
            // --------------------------------------------------------

            const {
                data: membership,
                error: membershipError,
            } = await supabase
                .from("family_members")
                .select("id, family_id, user_id, joined_at")
                .eq("user_id", currentUserId)
                .limit(1)
                .maybeSingle();

            if (membershipError) {
                console.error(
                    "Family membership query failed:",
                    membershipError
                );

                console.error(
                    "Membership error details:",
                    JSON.stringify(
                        membershipError,
                        Object.getOwnPropertyNames(membershipError),
                        2
                    )
                );

                setFamily(null);
                setMembers([]);
                setBooks([]);
                setInvites([]);

                setError(
                    "We couldn't check your family membership. Please make sure the family database policies have been set up correctly."
                );

                return;
            }

            // --------------------------------------------------------
            // No membership means the user can create a family
            // --------------------------------------------------------

            if (!membership) {
                setFamily(null);
                setMembers([]);
                setBooks([]);
                setInvites([]);

                return;
            }

            // --------------------------------------------------------
            // Get family
            //
            // At this point the user is already a member, so the
            // families SELECT policy should allow this query.
            // --------------------------------------------------------

            const {
                data: familyData,
                error: familyError,
            } = await supabase
                .from("families")
                .select("*")
                .eq("id", membership.family_id)
                .single();

            if (familyError) {
                console.error("Error loading family:", familyError);

                setError(
                    `We couldn't load your family. ${familyError.message || ""
                    }`
                );

                return;
            }

            if (!familyData) {
                setFamily(null);
                setMembers([]);
                setBooks([]);
                setInvites([]);

                return;
            }

            setFamily(familyData);

            // --------------------------------------------------------
            // Get family members
            // --------------------------------------------------------

            const {
                data: membersData,
                error: membersError,
            } = await supabase
                .from("family_members")
                .select("id, family_id, user_id, joined_at")
                .eq("family_id", membership.family_id)
                .order("joined_at", {
                    ascending: true,
                });

            if (membersError) {
                console.error(
                    "Error loading family members:",
                    membersError
                );

                setError(
                    `We couldn't load your family members. ${membersError.message || ""
                    }`
                );

                return;
            }

            const safeMembers = membersData || [];

            setMembers(safeMembers);

            // --------------------------------------------------------
            // Get books belonging to family members
            // --------------------------------------------------------

            const memberIds = safeMembers.map(
                (member) => member.user_id
            );

            if (memberIds.length > 0) {
                const {
                    data: booksData,
                    error: booksError,
                } = await supabase
                    .from("books")
                    .select(`
                        id,
                        user_id,
                        title,
                        author,
                        cover_url,
                        status,
                        added_at
                    `)
                    .in("user_id", memberIds)
                    .order("added_at", {
                        ascending: false,
                    });

                if (booksError) {
                    console.error(
                        "Error loading family books:",
                        booksError
                    );

                    setError(
                        `We couldn't load the shared library. ${booksError.message || ""
                        }`
                    );

                    return;
                }

                setBooks(booksData || []);
            } else {
                setBooks([]);
            }

            // --------------------------------------------------------
            // Get pending invitations
            // --------------------------------------------------------

            const {
                data: invitesData,
                error: invitesError,
            } = await supabase
                .from("family_invites")
                .select(`
                    id,
                    invited_email,
                    status,
                    created_at,
                    expires_at
                `)
                .eq("family_id", membership.family_id)
                .eq("status", "pending")
                .order("created_at", {
                    ascending: false,
                });

            if (invitesError) {
                console.error(
                    "Error loading invitations:",
                    invitesError
                );

                // Invitations should not prevent the family
                // library from loading.
                setInvites([]);
            } else {
                setInvites(invitesData || []);
            }
        } catch (error) {
            console.error("Unexpected family error:", error);

            setError(
                "Something went wrong while loading your family."
            );
        } finally {
            setLoading(false);
        }
    }

    // ============================================================
    // CREATE FAMILY
    // ============================================================

    async function createFamily() {
        const trimmedFamilyName = familyName.trim();

        if (!trimmedFamilyName) {
            setError("Please enter a family name.");
            return;
        }

        setCreatingFamily(true);
        setError("");
        setSuccess("");

        try {
            // --------------------------------------------------------
            // Get the authenticated user directly from Supabase.
            //
            // We do not rely on the userId React state here because
            // the state may not have finished updating yet.
            // --------------------------------------------------------

            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError) {
                console.error(
                    "Error getting authenticated user:",
                    userError
                );

                setError(
                    `Could not verify your login: ${userError.message || "Unknown error"
                    }`
                );

                return;
            }

            if (!user) {
                setError(
                    "You need to be logged in to create a family."
                );

                router.push("/login");
                return;
            }

            const currentUserId = user.id;

            setUserId(currentUserId);

            // --------------------------------------------------------
            // Generate the family ID ourselves.
            //
            // This is the important fix.
            //
            // We now know the family ID before inserting the family,
            // so we don't need to INSERT -> SELECT -> INSERT.
            // --------------------------------------------------------

            const newFamilyId = crypto.randomUUID();

            // --------------------------------------------------------
            // Create the family
            //
            // IMPORTANT:
            // Do NOT use .select() here.
            //
            // The families SELECT policy requires the user to be a
            // family member. The creator isn't a member yet.
            // --------------------------------------------------------

            const { error: familyError } = await supabase
                .from("families")
                .insert({
                    id: newFamilyId,
                    name: trimmedFamilyName,
                    created_by: currentUserId,
                });

            if (familyError) {
                console.error(
                    "Error creating family:",
                    familyError
                );

                console.error(
                    "Family error details:",
                    JSON.stringify(
                        familyError,
                        Object.getOwnPropertyNames(familyError),
                        2
                    )
                );

                setError(
                    `Could not create family: ${familyError.message || "Unknown error"
                    }`
                );

                return;
            }

            // --------------------------------------------------------
            // Add creator as the first family member
            //
            // This must happen before loadFamily(), because the
            // families SELECT policy uses is_family_member(id).
            // --------------------------------------------------------

            const { error: memberError } = await supabase
                .from("family_members")
                .insert({
                    family_id: newFamilyId,
                    user_id: currentUserId,
                });

            if (memberError) {
                console.error(
                    "Error adding family creator:",
                    memberError
                );

                console.error(
                    "Member error details:",
                    JSON.stringify(
                        memberError,
                        Object.getOwnPropertyNames(memberError),
                        2
                    )
                );

                // ----------------------------------------------------
                // The family was created but the creator could not be
                // added as a member.
                //
                // Try to clean up the incomplete family.
                // ----------------------------------------------------

                const { error: cleanupError } = await supabase
                    .from("families")
                    .delete()
                    .eq("id", newFamilyId)
                    .eq("created_by", currentUserId);

                if (cleanupError) {
                    console.error(
                        "Could not clean up incomplete family:",
                        cleanupError
                    );
                }

                setError(
                    `Could not finish creating your family: ${memberError.message || "Unknown error"
                    }`
                );

                return;
            }

            // --------------------------------------------------------
            // Everything succeeded.
            // --------------------------------------------------------

            setFamilyName("");

            setSuccess(
                "Your family has been created successfully."
            );

            // --------------------------------------------------------
            // Now the creator is a family member, so loadFamily()
            // can successfully pass the families SELECT policy.
            // --------------------------------------------------------

            await loadFamily();
        } catch (error) {
            console.error(
                "Unexpected family creation error:",
                error
            );

            setError(
                "Something went wrong while creating the family."
            );
        } finally {
            setCreatingFamily(false);
        }
    }

    // ============================================================
    // CREATE INVITATION
    // ============================================================

    async function sendInvite() {
        if (!inviteEmail.trim()) {
            setError("Please enter an email address.");
            return;
        }

        if (!family) {
            setError("You need to create a family first.");
            return;
        }

        if (!userId) {
            setError("You need to be logged in.");
            return;
        }

        const email = inviteEmail.trim().toLowerCase();

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            setError("Please enter a valid email address.");
            return;
        }

        setSendingInvite(true);
        setError("");
        setSuccess("");

        try {
            // --------------------------------------------------------
            // Verify the authenticated user
            // --------------------------------------------------------

            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError || !user) {
                console.error(
                    "Could not verify authenticated user:",
                    userError
                );

                setError(
                    "Your login session could not be verified. Please log in again."
                );

                return;
            }

            // --------------------------------------------------------
            // Check existing pending invitation
            // --------------------------------------------------------

            const {
                data: existingInvite,
                error: existingInviteError,
            } = await supabase
                .from("family_invites")
                .select("id")
                .eq("family_id", family.id)
                .eq("invited_email", email)
                .eq("status", "pending")
                .maybeSingle();

            if (existingInviteError) {
                console.error(
                    "Error checking existing invitation:",
                    existingInviteError
                );

                setError(
                    `Could not check existing invitations: ${existingInviteError.message ||
                    "Unknown error"
                    }`
                );

                return;
            }

            if (existingInvite) {
                setError(
                    "An invitation has already been sent to this email address."
                );

                return;
            }

            // --------------------------------------------------------
            // Generate invitation ID ourselves
            // --------------------------------------------------------

            const invitationId =
                crypto.randomUUID();

            // --------------------------------------------------------
            // Create invitation
            // --------------------------------------------------------

            const {
                error: inviteError,
            } = await supabase
                .from("family_invites")
                .insert({
                    id: invitationId,
                    family_id: family.id,
                    invited_email: email,
                    invited_by: user.id,
                });

            if (inviteError) {
                console.error(
                    "Error creating invitation:",
                    inviteError
                );

                console.error(
                    "Invitation error details:",
                    JSON.stringify(
                        inviteError,
                        Object.getOwnPropertyNames(
                            inviteError
                        ),
                        2
                    )
                );

                setError(
                    `Could not create invitation: ${inviteError.message ||
                    "Unknown error"
                    }`
                );

                return;
            }

            console.log(
                "Family invitation created:",
                invitationId
            );

            // --------------------------------------------------------
            // Determine inviter's display name
            // --------------------------------------------------------

            const inviterName =
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                user.email?.split("@")[0] ||
                "A family member";

            // --------------------------------------------------------
            // Send invitation email
            // --------------------------------------------------------

            const emailResponse = await fetch(
                "/api/family-invite",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email,
                        familyName: family.name,
                        inviterName,
                        inviteId: invitationId,
                    }),
                }
            );

            let emailResult: {
                success?: boolean;
                emailId?: string | null;
                error?: string;
            } | null = null;

            try {
                emailResult =
                    await emailResponse.json();
            } catch {
                emailResult = null;
            }

            // --------------------------------------------------------
            // Email failed
            // --------------------------------------------------------

            if (
                !emailResponse.ok ||
                !emailResult?.success
            ) {
                console.error(
                    "Invitation email failed:",
                    emailResult
                );

                setError(
                    emailResult?.error ||
                    "The invitation was created, but we couldn't send the email."
                );

                return;
            }

            // --------------------------------------------------------
            // Everything succeeded
            // --------------------------------------------------------

            setInviteEmail("");

            setSuccess(
                `Invitation sent successfully to ${email}.`
            );

            await loadFamily();
        } catch (error) {
            console.error(
                "Unexpected invitation error:",
                error
            );

            setError(
                "Something went wrong while sending the invitation."
            );
        } finally {
            setSendingInvite(false);
        }
    }

    // ============================================================
    // STATUS LABEL
    // ============================================================

    function getStatusLabel(status: string | null) {
        switch (status) {
            case "want_to_read":
                return "Want to Read";

            case "reading":
                return "Reading";

            case "finished":
                return "Finished";

            default:
                return "Not Set";
        }
    }

    // ============================================================
    // LOADING
    // ============================================================

    if (loading) {
        return (
            <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
                <Navbar />

                <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
                    <div className="text-center">
                        <p className="text-slate-500">
                            Loading your family...
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    // ============================================================
    // NO FAMILY
    // ============================================================

    if (!family) {
        return (
            <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
                <style jsx global>{`
                    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');

                    .font-classical {
                        font-family: "Playfair Display", serif;
                    }
                `}</style>

                <Navbar isLoggedIn={!!userId} />

                <section className="max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-20">
                    <div className="text-center mb-12">
                        <p className="text-sm uppercase tracking-[0.2em] text-[#7a947c] font-medium mb-4">
                            Shared Reading
                        </p>

                        <h1 className="font-classical text-4xl sm:text-5xl font-semibold mb-5">
                            Create your family library
                        </h1>

                        <p className="text-slate-600 max-w-xl mx-auto leading-relaxed">
                            Create a shared space for the people you
                            read with. Everyone keeps their own personal
                            library, while family members can discover
                            and read each other's books.
                        </p>
                    </div>

                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-10">
                        <h2 className="font-classical text-2xl font-semibold mb-2">
                            Create a family
                        </h2>

                        <p className="text-slate-500 text-sm mb-6">
                            Give your family library a name.
                        </p>

                        <input
                            type="text"
                            value={familyName}
                            onChange={(event) =>
                                setFamilyName(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    createFamily();
                                }
                            }}
                            placeholder="e.g. The Smith Family"
                            className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-[#Fdfaf3] text-[#0f172a] outline-none focus:border-[#7a947c] transition-colors"
                        />

                        {error && (
                            <div className="mt-4 p-4 rounded-xl bg-red-50 text-red-700 text-sm">
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="mt-4 p-4 rounded-xl bg-green-50 text-green-700 text-sm">
                                {success}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={createFamily}
                            disabled={creatingFamily}
                            className="mt-6 w-full sm:w-auto px-6 py-3.5 rounded-xl bg-[#7a947c] text-white font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {creatingFamily
                                ? "Creating..."
                                : "Create Family"}
                        </button>
                    </div>
                </section>
            </main>
        );
    }

    // ============================================================
    // FAMILY LIBRARY
    // ============================================================

    return (
        <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a]">
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');

                .font-classical {
                    font-family: "Playfair Display", serif;
                }
            `}</style>

            <Navbar isLoggedIn={!!userId} />

            <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-20">

                {/* ================================================== */}
                {/* HEADER */}
                {/* ================================================== */}

                <div className="pt-6 sm:pt-10 pb-10">
                    <p className="text-sm uppercase tracking-[0.2em] text-[#7a947c] font-medium mb-3">
                        Shared Library
                    </p>

                    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                        <div>
                            <h1 className="font-classical text-4xl sm:text-5xl font-semibold mb-4">
                                {family.name}
                            </h1>

                            <p className="text-slate-500">
                                {members.length}{" "}
                                {members.length === 1
                                    ? "member"
                                    : "members"}{" "}
                                · {books.length}{" "}
                                {books.length === 1
                                    ? "book"
                                    : "books"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ================================================== */}
                {/* MESSAGES */}
                {/* ================================================== */}

                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="mb-6 p-4 rounded-xl bg-green-50 text-green-700 text-sm">
                        {success}
                    </div>
                )}

                {/* ================================================== */}
                {/* MEMBERS + INVITE */}
                {/* ================================================== */}

                <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 mb-12">

                    {/* MEMBERS */}

                    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <p className="text-sm text-slate-400 uppercase tracking-wider">
                                    Family
                                </p>

                                <h2 className="font-classical text-2xl font-semibold mt-1">
                                    Members
                                </h2>
                            </div>

                            <div className="w-11 h-11 rounded-full bg-[#d8d0e3] flex items-center justify-center text-[#0f172a] font-classical text-lg">
                                {members.length}
                            </div>
                        </div>

                        <div className="space-y-3">
                            {members.map((member) => (
                                <div
                                    key={member.id}
                                    className="flex items-center gap-4 p-4 rounded-xl bg-[#Fdfaf3]"
                                >
                                    <div className="w-10 h-10 rounded-full bg-[#0f172a] text-white flex items-center justify-center font-classical">
                                        {member.user_id === userId
                                            ? "Y"
                                            : "M"}
                                    </div>

                                    <div>
                                        <p className="font-medium">
                                            {member.user_id === userId
                                                ? "You"
                                                : "Family Member"}
                                        </p>

                                        <p className="text-xs text-slate-400">
                                            Joined{" "}
                                            {new Date(
                                                member.joined_at
                                            ).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* INVITE */}

                    <div className="bg-[#0f172a] text-white rounded-3xl shadow-sm p-6 sm:p-8">
                        <p className="text-sm text-[#d8d0e3] uppercase tracking-wider">
                            Grow your library
                        </p>

                        <h2 className="font-classical text-2xl font-semibold mt-1 mb-3">
                            Invite someone
                        </h2>

                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            Invite a family member to join this shared
                            library. Their personal books will remain
                            separate while appearing here.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="email"
                                value={inviteEmail}
                                onChange={(event) =>
                                    setInviteEmail(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        sendInvite();
                                    }
                                }}
                                placeholder="email@example.com"
                                className="flex-1 px-4 py-3.5 rounded-xl bg-white text-[#0f172a] outline-none placeholder:text-slate-400"
                            />

                            <button
                                type="button"
                                onClick={sendInvite}
                                disabled={sendingInvite}
                                className="px-6 py-3.5 rounded-xl bg-[#7a947c] text-white font-medium hover:bg-[#6b826c] transition-colors disabled:opacity-50"
                            >
                                {sendingInvite
                                    ? "Sending..."
                                    : "Invite"}
                            </button>
                        </div>

                        {/* PENDING INVITES */}

                        {invites.length > 0 && (
                            <div className="mt-8 pt-6 border-t border-white/10">
                                <p className="text-sm text-slate-400 mb-3">
                                    Pending invitations
                                </p>

                                <div className="space-y-2">
                                    {invites.map((invite) => (
                                        <div
                                            key={invite.id}
                                            className="flex items-center justify-between gap-4 text-sm"
                                        >
                                            <span className="text-slate-200 truncate">
                                                {invite.invited_email}
                                            </span>

                                            <span className="text-[#d8d0e3] text-xs shrink-0">
                                                Pending
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ================================================== */}
                {/* SHARED BOOKS */}
                {/* ================================================== */}

                <div>
                    <div className="flex items-end justify-between mb-6">
                        <div>
                            <p className="text-sm text-[#7a947c] uppercase tracking-wider">
                                Everyone's books
                            </p>

                            <h2 className="font-classical text-3xl font-semibold mt-1">
                                Shared Library
                            </h2>
                        </div>
                    </div>

                    {books.length === 0 ? (
                        <div className="bg-white rounded-3xl border border-slate-100 p-10 text-center">
                            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#d8d0e3] flex items-center justify-center">
                                <span className="font-classical text-2xl">
                                    A
                                </span>
                            </div>

                            <h3 className="font-classical text-xl font-semibold mb-2">
                                No books yet
                            </h3>

                            <p className="text-slate-500 text-sm max-w-md mx-auto">
                                Add books to your personal library and
                                they'll appear here for your family to
                                discover.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                            {books.map((book) => (
                                <div
                                    key={book.id}
                                    className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
                                >
                                    {/* COVER */}

                                    <div className="aspect-[2/3] bg-[#d8d0e3] relative">
                                        {book.cover_url ? (
                                            <img
                                                src={book.cover_url}
                                                alt={book.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center p-5 text-center">
                                                <span className="font-classical text-lg text-[#0f172a]">
                                                    {book.title}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* DETAILS */}

                                    <div className="p-4">
                                        <h3 className="font-classical font-semibold leading-snug line-clamp-2">
                                            {book.title}
                                        </h3>

                                        {book.author && (
                                            <p className="text-sm text-slate-500 mt-1 line-clamp-1">
                                                {book.author}
                                            </p>
                                        )}

                                        <div className="mt-3 flex items-center justify-between gap-2">
                                            <span className="text-xs text-slate-400">
                                                {getStatusLabel(
                                                    book.status
                                                )}
                                            </span>

                                            <span className="text-xs px-2 py-1 rounded-full bg-[#Fdfaf3] text-[#7a947c]">
                                                {book.user_id === userId
                                                    ? "Your book"
                                                    : "Family book"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}