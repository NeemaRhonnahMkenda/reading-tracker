import Link from "next/link";
import Navbar from "./components/Navbar";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-slate-800 font-sans selection:bg-[#d8d0e3] relative selection:text-[#0f172a]">
      
      {/* Import a memorable classical font (Playfair Display) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', serif; }
          `,
        }}
      />

      {/* Subtle, static background gradients for an elevated feel without distraction */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[120px] -z-10 pointer-events-none" />

      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[120px] -z-10 pointer-events-none" />

      {/* Navigation */}
      <Navbar isLoggedIn={false} />

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-8 pt-32 pb-24 text-center relative z-10">
        <h1 className="text-5xl md:text-7xl font-classical font-semibold text-[#0f172a] leading-[1.1] mb-8">
          A quiet space for your <br />
          <span className="italic text-[#7a947c]">literary life.</span>
        </h1>

        <p className="text-xl text-slate-600 mb-14 max-w-2xl mx-auto font-light leading-relaxed">
          Curate your personal collection, log your reading hours, and journal
          your thoughts. A beautifully crafted archive designed for the
          intentional reader.
        </p>

        {/* Elegant Action Button */}
        <Link
          href="/login"
          className="text-lg text-[#Fdfaf3] bg-[#7a947c] px-10 py-4 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 hover:bg-[#6b826c] transition-all flex items-center gap-3 mx-auto w-fit"
        >
          <span>Open Your Archive</span>

          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </Link>
      </section>

      {/* Features Grid - Minimalist & Elegant */}
      <section className="max-w-6xl mx-auto px-8 py-20 relative z-10 border-t border-[#0f172a]/5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-16">

          {/* Feature 1 */}
          <div className="group">
            <div className="w-14 h-14 rounded-2xl bg-[#f0f4f1] flex items-center justify-center mb-8 text-[#7a947c] group-hover:bg-[#7a947c] group-hover:text-[#Fdfaf3] transition-colors duration-500 shadow-sm">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <h3 className="text-2xl font-semibold mb-4 font-classical text-[#0f172a]">
              Catalog Your Collection
            </h3>

            <p className="text-slate-600 font-light leading-relaxed">
              Digitize your physical shelves. Sort books by what you currently
              own, what you've finished reading, and the titles waiting on
              your wishlist.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group">
            <div className="w-14 h-14 rounded-2xl bg-[#f7f5fa] flex items-center justify-center mb-8 text-[#9a86b9] group-hover:bg-[#9a86b9] group-hover:text-[#Fdfaf3] transition-colors duration-500 shadow-sm">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <h3 className="text-2xl font-semibold mb-4 font-classical text-[#0f172a]">
              Log Your Sessions
            </h3>

            <p className="text-slate-600 font-light leading-relaxed">
              Measure your reading life in pages and hours, not streaks. Gain
              insight into your pace and habits over time without the pressure.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-8 text-[#0f172a] group-hover:bg-[#0f172a] group-hover:text-[#Fdfaf3] transition-colors duration-500 shadow-sm">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </div>

            <h3 className="text-2xl font-semibold mb-4 font-classical text-[#0f172a]">
              Journal & Reflect
            </h3>

            <p className="text-slate-600 font-light leading-relaxed">
              Leave thoughtful ratings, capture favorite quotes, and write
              personal reviews to remember exactly how a book moved you.
            </p>
          </div>

        </div>
      </section>
    </main>
  );
}