export default function GalleryPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900">Your Gallery</h2>
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="aspect-square rounded-2xl bg-gray-200 animate-pulse" />
        ))}
      </div>
      <p className="text-center text-sm text-gray-500 py-10">
        Your creations will appear here.
      </p>
    </div>
  );
}
