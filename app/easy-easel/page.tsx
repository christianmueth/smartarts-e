export const dynamic = "force-dynamic";

export default function EasyEaselPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 md:px-6 md:py-14">
        <section className="rounded-[2rem] border border-pink-200/80 bg-white/82 p-8 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
          <div className="inline-flex w-fit rounded-full border border-yellow-300 bg-yellow-100/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-pink-700">
            Easy Easel
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#7a1f4f]">Easy Easel</h1>
          <p className="mt-3 text-sm text-pink-600">Stand by for instructions.</p>
        </section>
      </div>
    </main>
  );
}
