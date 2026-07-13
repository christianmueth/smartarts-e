const pipelineStages = [
  {
    title: "Concept framing",
    description: "Turn a mood board, campaign brief, or rough note into a production-ready creative direction with visual constraints, references, and asset goals.",
  },
  {
    title: "Generative production",
    description: "Use AI to draft keyframes, environment studies, product composites, texture passes, and alternate stylistic treatments before human refinement.",
  },
  {
    title: "Delivery orchestration",
    description: "Move final selects into channel-ready outputs for social launches, print systems, pitch decks, and gallery-scale presentations.",
  },
];

const studioTracks = [
  "Campaign concept art",
  "Editorial illustration systems",
  "Product launch visuals",
  "Storyboards and look-dev",
  "Motion-ready key art",
  "Client review variants",
];

const operatingPrinciples = [
  "Human art direction stays in control of taste, pacing, and final approvals.",
  "AI handles iteration volume, exploratory branching, and labor-heavy draft generation.",
  "Production stays organized around reusable prompt frameworks, asset libraries, and revision checkpoints.",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.14),_transparent_28%),radial-gradient(circle_at_85%_15%,_rgba(56,189,248,0.16),_transparent_24%),linear-gradient(180deg,_#fffaf4_0%,_#fff4e8_52%,_#f7efe7_100%)] text-stone-950">
      <section className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-12 pt-10 md:px-6 md:pb-20 md:pt-16">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div className="space-y-6">
            <p className="inline-flex rounded-full border border-orange-200 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-orange-700 shadow-sm">
              SmartArts AI Production Studio
            </p>
            <div className="space-y-4">
              <h1 className="max-w-4xl font-serif text-5xl leading-none tracking-[-0.04em] text-stone-950 sm:text-6xl lg:text-7xl">
                Build art campaigns with AI as a production engine, not a gimmick.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">
                SmartArts is now centered on AI-enabled art production: concept development, generative asset creation, rapid visual iteration, and polished delivery for commercial and creative teams.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-stone-200 bg-white/80 p-6 shadow-[0_24px_80px_rgba(120,53,15,0.10)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Production focus</p>
            <div className="mt-5 space-y-4 text-sm leading-7 text-stone-700">
              <p>From first prompt architecture to final review boards, every visible surface now points toward visual production work.</p>
              <p>Unrelated tutoring, study, and label-review flows are no longer part of the site experience.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {pipelineStages.map((stage) => (
            <article key={stage.title} className="rounded-[1.75rem] border border-stone-200 bg-white/85 p-6 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Workflow</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">{stage.title}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-700">{stage.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-stone-200/80 bg-white/70">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 md:grid-cols-[0.9fr_1.1fr] md:px-6 md:py-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Studio outputs</p>
            <h2 className="mt-3 font-serif text-4xl leading-tight tracking-[-0.03em] text-stone-950">The site now speaks to image making, art direction, and delivery.</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {studioTracks.map((track) => (
              <div key={track} className="rounded-[1.5rem] border border-stone-200 bg-stone-950 px-5 py-4 text-sm font-medium text-stone-50 shadow-sm">
                {track}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:px-6 md:py-20 lg:grid-cols-[1fr_0.85fr] lg:items-start">
        <div className="rounded-[2rem] border border-stone-200 bg-white/80 p-7 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Operating model</p>
          <div className="mt-5 space-y-4">
            {operatingPrinciples.map((principle) => (
              <div key={principle} className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-4 text-sm leading-7 text-stone-700">
                {principle}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-[linear-gradient(145deg,_rgba(28,25,23,0.95),_rgba(68,64,60,0.92))] p-7 text-stone-50 shadow-[0_30px_100px_rgba(28,25,23,0.22)]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Current direction</p>
          <h2 className="mt-3 font-serif text-4xl leading-tight tracking-[-0.03em]">One clear story: AI-enabled art production.</h2>
          <p className="mt-4 text-sm leading-7 text-stone-200">
            SmartArts should now read like a focused studio platform for visual development and campaign execution. The public experience has been narrowed to that positioning.
          </p>
        </div>
      </section>
    </main>
  );
}
