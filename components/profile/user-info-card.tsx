import { Globe, Mail, Shield, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AppUser } from "@/lib/auth0-types";

function getAvatarFallback(user: AppUser) {
  if (user.given_name && user.family_name) {
    return `${user.given_name[0]}${user.family_name[0]}`;
  }
  if (user.nickname) {
    return user.nickname[0];
  }
  return user.name?.[0] || "U";
}

export function UserInfoCard({ user }: { user: AppUser }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex flex-col items-center space-y-4">
        <Avatar className="h-24 w-24">
          <AvatarImage alt={user.name ?? ""} src={user.picture} />
          <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
            {getAvatarFallback(user)}
          </AvatarFallback>
        </Avatar>

        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold text-foreground">
            {user.name || user.nickname || "User"}
          </h2>
          {user.email && (
            <p className="flex items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              {user.email}
              {user.email_verified && (
                <span title="Verified">
                  <Shield className="h-4 w-4 text-green-500" />
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div className="border-t pt-4">
          <h3 className="mb-3 text-lg font-medium text-foreground">
            Account Details
          </h3>

          <div className="space-y-3 text-sm">
            {user.sub && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">User ID:</span>
                <span className="break-all text-foreground">{user.sub}</span>
              </div>
            )}

            {user.given_name && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">First Name:</span>
                <span className="text-foreground">{user.given_name}</span>
              </div>
            )}

            {user.family_name && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Last Name:</span>
                <span className="text-foreground">{user.family_name}</span>
              </div>
            )}

            {user.nickname && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Nickname:</span>
                <span className="text-foreground">{user.nickname}</span>
              </div>
            )}

            {user.org_id && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Organization ID:</span>
                <span className="break-all text-foreground">{user.org_id}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
