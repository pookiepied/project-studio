/** The two roles the umbrella knows about. See ADR-0001 §Roles before adding a third. */
export type Role = "admin" | "user";

/** Account status. `invited` is allowlisted-but-never-logged-in. */
export type UserStatus = "invited" | "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

export interface Identity {
  user: User;
  session: Session;
}

/**
 * The only interface an app worker depends on. The auth worker implements it
 * over a service binding; a test can implement it with an object literal.
 * Deliberately narrow so the auth implementation can be replaced wholesale.
 */
export interface AuthService {
  validate(token: string): Promise<Identity | null>;
}
