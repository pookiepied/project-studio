import { useState } from "react";
import type { WhitelistedUser } from "../types";
import { getInitials } from "../helpers";

export const Avatar = ({ user }: { user: WhitelistedUser }) => {
  const [imgError, setImgError] = useState(false);
  const initials = getInitials(user.name, user.email);

  if (user.picture && !imgError) {
    return (
      <img
        src={user.picture}
        alt={user.name ?? user.email}
        onError={() => setImgError(true)}
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center flex-shrink-0">
      <span className="text-2xs font-semibold text-muted font-sans">
        {initials}
      </span>
    </div>
  );
};
