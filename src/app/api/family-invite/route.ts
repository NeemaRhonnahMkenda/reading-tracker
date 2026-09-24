import { NextResponse } from "next/server";
import { Resend } from "resend";

interface InvitationRequest {
    email: string;
    familyName: string;
    inviterName?: string;
    inviteId: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export async function POST(request: Request) {
    console.log(
        "=================================================="
    );

    console.log(
        "FAMILY INVITATION API CALLED"
    );

    console.log(
        "=================================================="
    );

    try {
        // ========================================================
        // CHECK ENVIRONMENT VARIABLES
        // ========================================================

        const apiKey =
            process.env.RESEND_API_KEY;

        const siteUrl =
            process.env.NEXT_PUBLIC_SITE_URL;

        console.log(
            "RESEND_API_KEY exists:",
            !!apiKey
        );

        console.log(
            "NEXT_PUBLIC_SITE_URL:",
            siteUrl
        );

        if (!apiKey) {
            console.error(
                "RESEND_API_KEY is missing."
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        "RESEND_API_KEY is not configured in .env.local.",
                },
                {
                    status: 500,
                }
            );
        }

        if (!siteUrl) {
            console.error(
                "NEXT_PUBLIC_SITE_URL is missing."
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        "NEXT_PUBLIC_SITE_URL is not configured in .env.local.",
                },
                {
                    status: 500,
                }
            );
        }

        // ========================================================
        // READ REQUEST
        // ========================================================

        let body: InvitationRequest;

        try {
            body =
                (await request.json()) as InvitationRequest;
        } catch (error) {
            console.error(
                "Could not parse request JSON:",
                error
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The invitation request contained invalid JSON.",
                },
                {
                    status: 400,
                }
            );
        }

        const {
            email,
            familyName,
            inviterName,
            inviteId,
        } = body;

        console.log(
            "Invitation request:",
            {
                email,
                familyName,
                inviterName,
                inviteId,
            }
        );

        // ========================================================
        // VALIDATE REQUEST
        // ========================================================

        if (
            !email ||
            !familyName ||
            !inviteId
        ) {
            console.error(
                "Missing invitation information."
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Missing email, family name, or invitation ID.",
                },
                {
                    status: 400,
                }
            );
        }

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            console.error(
                "Invalid email:",
                email
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The email address is invalid.",
                },
                {
                    status: 400,
                }
            );
        }

        // ========================================================
        // CREATE INVITATION URL
        // ========================================================

        const inviteUrl =
            `${siteUrl}/family/invite/${encodeURIComponent(
                inviteId
            )}`;

        console.log(
            "Invitation URL:",
            inviteUrl
        );

        // ========================================================
        // ESCAPE HTML
        // ========================================================

        const safeEmail =
            escapeHtml(email);

        const safeFamilyName =
            escapeHtml(familyName);

        const safeInviterName =
            escapeHtml(
                inviterName ||
                "A family member"
            );

        const safeInviteUrl =
            escapeHtml(inviteUrl);

        // ========================================================
        // EMAIL HTML
        // ========================================================

        const html = `
<!DOCTYPE html>

<html lang="en">

<head>

    <meta charset="UTF-8" />

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    />

    <title>
        You're invited to join ${safeFamilyName}
    </title>

</head>

<body
    style="
        margin: 0;
        padding: 0;
        background-color: #fdfaf3;
        font-family: Arial, Helvetica, sans-serif;
        color: #0f172a;
    "
>

    <div
        style="
            width: 100%;
            background-color: #fdfaf3;
            padding: 40px 20px;
            box-sizing: border-box;
        "
    >

        <div
            style="
                max-width: 620px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 24px;
                overflow: hidden;
                border: 1px solid #eef0ec;
            "
        >

            <!-- HEADER -->

            <div
                style="
                    padding: 34px 40px 20px;
                    text-align: center;
                "
            >

                <p
                    style="
                        margin: 0 0 12px;
                        color: #7a947c;
                        font-size: 12px;
                        font-weight: 600;
                        letter-spacing: 2px;
                        text-transform: uppercase;
                    "
                >
                    Shared Reading
                </p>

                <h1
                    style="
                        margin: 0;
                        color: #0f172a;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 32px;
                        font-weight: 600;
                    "
                >
                    Family Library
                </h1>

            </div>

            <!-- MAIN CONTENT -->

            <div
                style="
                    padding: 20px 40px 42px;
                    text-align: center;
                "
            >

                <div
                    style="
                        width: 64px;
                        height: 64px;
                        margin: 0 auto 24px;
                        border-radius: 50%;
                        background-color: #d8d0e3;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #0f172a;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 28px;
                    "
                >
                    A
                </div>

                <h2
                    style="
                        margin: 0 0 14px;
                        color: #0f172a;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 27px;
                        font-weight: 600;
                    "
                >
                    You're invited
                </h2>

                <p
                    style="
                        margin: 0 0 8px;
                        color: #475569;
                        font-size: 16px;
                        line-height: 1.7;
                    "
                >
                    <strong>
                        ${safeInviterName}
                    </strong>

                    has invited you to join
                </p>

                <p
                    style="
                        margin: 0 0 24px;
                        color: #0f172a;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 23px;
                        font-weight: 600;
                    "
                >
                    ${safeFamilyName}
                </p>

                <p
                    style="
                        max-width: 470px;
                        margin: 0 auto 30px;
                        color: #64748b;
                        font-size: 15px;
                        line-height: 1.7;
                    "
                >
                    Join your family's shared reading space,
                    discover the books they're reading, and let
                    them discover yours.
                </p>

                <a
                    href="${safeInviteUrl}"
                    style="
                        display: inline-block;
                        padding: 15px 28px;
                        background-color: #7a947c;
                        color: #ffffff;
                        text-decoration: none;
                        border-radius: 12px;
                        font-size: 15px;
                        font-weight: 600;
                    "
                >
                    Accept Invitation
                </a>

                <p
                    style="
                        margin: 28px auto 0;
                        color: #94a3b8;
                        font-size: 12px;
                    "
                >
                    If the button doesn't work, copy and paste
                    this link into your browser:
                </p>

                <p
                    style="
                        margin: 8px auto 0;
                        word-break: break-all;
                        font-size: 12px;
                    "
                >
                    <a
                        href="${safeInviteUrl}"
                        style="
                            color: #7a947c;
                            text-decoration: none;
                        "
                    >
                        ${safeInviteUrl}
                    </a>
                </p>

            </div>

            <!-- INVITATION DETAILS -->

            <div
                style="
                    margin: 0 40px 40px;
                    padding: 18px 20px;
                    background-color: #fdfaf3;
                    border-radius: 14px;
                "
            >

                <p
                    style="
                        margin: 0 0 6px;
                        color: #94a3b8;
                        font-size: 11px;
                        font-weight: 600;
                        letter-spacing: 1px;
                        text-transform: uppercase;
                    "
                >
                    Invitation sent to
                </p>

                <p
                    style="
                        margin: 0;
                        color: #334155;
                        font-size: 14px;
                    "
                >
                    ${safeEmail}
                </p>

            </div>

            <!-- FOOTER -->

            <div
                style="
                    padding: 26px 40px;
                    background-color: #0f172a;
                    text-align: center;
                "
            >

                <p
                    style="
                        margin: 0 0 7px;
                        color: #ffffff;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 18px;
                    "
                >
                    Family Library
                </p>

                <p
                    style="
                        margin: 0;
                        color: #cbd5e1;
                        font-size: 12px;
                    "
                >
                    A shared space for the books you love.
                </p>

            </div>

        </div>

    </div>

</body>

</html>
        `;

        // ========================================================
        // CREATE RESEND CLIENT
        // ========================================================

        const resend =
            new Resend(apiKey);

        // ========================================================
        // SEND EMAIL
        // ========================================================

        console.log(
            "Attempting to send email through Resend..."
        );

        const { data, error } = await resend.emails.send({
            from: "The Archive <thearchive@thekhandas.com>",
            to: [email],
            subject: `You're invited to join ${familyName}`,
            html,
        });

        // ========================================================
        // RESEND ERROR
        // ========================================================

        if (error) {
            console.error(
                "=================================================="
            );

            console.error(
                "RESEND ERROR"
            );

            console.error(
                "=================================================="
            );

            console.error(
                "Error object:",
                error
            );

            console.error(
                "Error JSON:",
                JSON.stringify(
                    error,
                    Object.getOwnPropertyNames(
                        error
                    ),
                    2
                )
            );

            return NextResponse.json(
                {
                    success: false,
                    error:
                        error.message ||
                        "Resend rejected the email.",
                    details: error,
                },
                {
                    status: 500,
                }
            );
        }

        // ========================================================
        // SUCCESS
        // ========================================================

        console.log(
            "=================================================="
        );

        console.log(
            "EMAIL SENT SUCCESSFULLY"
        );

        console.log(
            "Resend response:",
            data
        );

        console.log(
            "=================================================="
        );

        return NextResponse.json(
            {
                success: true,
                emailId:
                    data?.id || null,
            },
            {
                status: 200,
            }
        );

    } catch (error) {

        console.error(
            "=================================================="
        );

        console.error(
            "UNEXPECTED EMAIL API ERROR"
        );

        console.error(
            "=================================================="
        );

        console.error(
            "Error:",
            error
        );

        console.error(
            "Error details:",
            JSON.stringify(
                error,
                Object.getOwnPropertyNames(
                    error || {}
                ),
                2
            )
        );

        return NextResponse.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected error while sending email.",
            },
            {
                status: 500,
            }
        );
    }
}