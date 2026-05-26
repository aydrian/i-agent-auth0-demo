import { redirect } from "next/navigation";
import { ProfileContent } from "@/components/profile/profile-content";
import { auth0 } from "@/lib/auth0";

export default async function ProfilePage() {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-foreground">Profile</h1>
          <p className="text-muted-foreground">
            Manage your connected accounts
          </p>
        </div>

        <ProfileContent user={session.user} />
      </div>
    </div>
  );
}
