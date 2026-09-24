import { NextResponse } from "next/server";

interface OpenLibraryAuthor {
  name?: string;
}

interface OpenLibraryBook {
  title?: string;
  authors?: {
    key?: string;
    name?: string;
  }[];
  isbn_10?: string[];
  isbn_13?: string[];
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  physical_format?: string;
  covers?: number[];
  key?: string;
}

interface OpenLibraryWork {
  authors?: {
    author?: {
      key?: string;
    };
  }[];
}

interface OpenLibraryAuthorDetails {
  name?: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ isbn: string }> }
) {
  try {
    const { isbn } = await params;

    // Remove spaces and hyphens
    const cleanISBN = isbn.replace(/[-\s]/g, "");

    // Validate ISBN-10 or ISBN-13
    if (!/^(?:\d{10}|\d{13})$/.test(cleanISBN)) {
      return NextResponse.json(
        {
          error: "Please enter a valid ISBN-10 or ISBN-13.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 1. Find the edition using the ISBN
    // --------------------------------------------------

    const response = await fetch(
      `https://openlibrary.org/isbn/${cleanISBN}.json`,
      {
        headers: {
          "User-Agent": "The Archive - Personal Library App",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Book not found.",
        },
        { status: 404 }
      );
    }

    const book: OpenLibraryBook = await response.json();

    // --------------------------------------------------
    // 2. Find the author
    // --------------------------------------------------

    let authorName: string | null =
      book.authors
        ?.map((author) => author.name)
        .filter(Boolean)
        .join(", ") || null;

    /*
      Some Open Library editions don't include the author's
      name directly.

      If that happens, use the edition's work/author references
      to retrieve the author.
    */

    if (!authorName && book.key) {
      try {
        const editionResponse = await fetch(
          `https://openlibrary.org${book.key}.json`,
          {
            headers: {
              "User-Agent": "The Archive - Personal Library App",
            },
          }
        );

        if (editionResponse.ok) {
          const editionData = await editionResponse.json();

          const workKey =
            editionData.works?.[0]?.key || null;

          if (workKey) {
            const workResponse = await fetch(
              `https://openlibrary.org${workKey}.json`,
              {
                headers: {
                  "User-Agent": "The Archive - Personal Library App",
                },
              }
            );

            if (workResponse.ok) {
              const work: OpenLibraryWork =
                await workResponse.json();

              const authorKey =
                work.authors?.[0]?.author?.key || null;

              if (authorKey) {
                const authorResponse = await fetch(
                  `https://openlibrary.org${authorKey}.json`,
                  {
                    headers: {
                      "User-Agent": "The Archive - Personal Library App",
                    },
                  }
                );

                if (authorResponse.ok) {
                  const author: OpenLibraryAuthorDetails =
                    await authorResponse.json();

                  authorName = author.name || null;
                }
              }
            }
          }
        }
      } catch (authorError) {
        console.error(
          "Could not retrieve author:",
          authorError
        );
      }
    }

    // --------------------------------------------------
    // 3. Format the book for The Archive
    // --------------------------------------------------

    const formattedBook = {
      title: book.title || null,

      author: authorName,

      isbn10: book.isbn_10?.[0] || null,

      isbn13: book.isbn_13?.[0] || null,

      publisher: book.publishers?.[0] || null,

      publishedDate: book.publish_date || null,

      pages: book.number_of_pages || null,

      binding: book.physical_format || null,

      coverUrl: book.covers?.[0]
        ? `https://covers.openlibrary.org/b/id/${book.covers[0]}-L.jpg`
        : null,

      openLibraryId: book.key || null,
    };

    return NextResponse.json(formattedBook);
  } catch (error) {
    console.error("ISBN lookup error:", error);

    return NextResponse.json(
      {
        error: "Something went wrong while looking up the book.",
      },
      { status: 500 }
    );
  }
}