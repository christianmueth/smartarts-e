export default function CreatePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-dashed border-gray-300 bg-gray-100 py-20 text-center">
        <span className="text-4xl">📸</span>
        <p className="mt-4 text-sm text-gray-600">Tap to upload or take a photo</p>
      </section>

      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Choose Style</h2>
        <div className="grid grid-cols-2 gap-3">
          {["Realistic", "Oil", "Watercolor", "Sketch"].map((style) => (
            <button key={style} className="rounded-2xl border border-gray-200 bg-white p-4 font-semibold text-gray-700 shadow-sm active:bg-gray-50">
              {style}
            </button>
          ))}
        </div>
      </div>

      <button className="w-full rounded-2xl bg-[#7a1f4f] py-4 text-lg font-bold text-white shadow-lg active:opacity-90">
        Generate Artwork
      </button>
    </div>
  );
}
