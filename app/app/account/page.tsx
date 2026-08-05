import { UserButton, UserProfile } from "@clerk/nextjs";

export default function AccountPage() {
  return (
    <div className="space-y-6 flex flex-col items-center">
      <h2 className="text-xl font-bold text-gray-900 self-start">Account</h2>
      <UserButton
        appearance={{
          elements: {
            userButtonAvatarBox: "h-20 w-20",
          }
        }}
      />
      <div className="w-full space-y-2">
        <button className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left font-medium text-gray-700">
          Subscription Plan
        </button>
        <button className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left font-medium text-gray-700">
          Settings
        </button>
        <button className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left font-medium text-red-600">
          Sign Out
        </button>
      </div>
    </div>
  );
}
