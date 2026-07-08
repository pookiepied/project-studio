/** Tool schema definitions for local user & group security tools. */
export const DESKTOP_SECURITY_DEFINITIONS = [
  // ── users (5 tools) ────────────────────────────────────────────────────────
  {
    name: "list_users",
    description: "List all local Windows user accounts: name, enabled status, last logon, password last set, account expiry, and whether password is required.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_user",
    description: "Create a new local Windows user account. Optionally set full name, description, and whether a password is required.",
    inputSchema: {
      type: "object",
      properties: {
        username:    { type: "string",  description: "Username for the new account" },
        password:    { type: "string",  description: "Password (required unless no_password is true)" },
        full_name:   { type: "string",  description: "Display name (optional)" },
        description: { type: "string",  description: "Account description (optional)" },
        no_password: { type: "boolean", description: "Create account with no password" },
      },
      required: ["username"],
    },
  },
  {
    name: "delete_user",
    description: "Delete a local Windows user account. This does NOT delete the user's profile folder.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string", description: "Username to delete" } },
      required: ["username"],
    },
  },
  {
    name: "set_user_password",
    description: "Change the password for a local Windows user account.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Username" },
        password: { type: "string", description: "New password" },
      },
      required: ["username","password"],
    },
  },
  {
    name: "manage_user_account",
    description: "Enable or disable a local Windows user account.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Username" },
        action:   { type: "string", enum: ["enable","disable"], description: "Action to perform" },
      },
      required: ["username","action"],
    },
  },

  // ── groups (3 tools) ───────────────────────────────────────────────────────
  {
    name: "list_groups",
    description: "List all local Windows groups. Optionally include the member list for each group.",
    inputSchema: {
      type: "object",
      properties: {
        include_members: { type: "boolean", description: "Include member list for each group (default: false)" },
      },
      required: [],
    },
  },
  {
    name: "get_group_members",
    description: "List all members (users and computers) of a specific local group, e.g. 'Administrators'.",
    inputSchema: {
      type: "object",
      properties: { group: { type: "string", description: "Group name e.g. 'Administrators'" } },
      required: ["group"],
    },
  },
  {
    name: "manage_group_member",
    description: "Add or remove a user from a local Windows group. Use to grant or revoke admin rights, etc.",
    inputSchema: {
      type: "object",
      properties: {
        action:   { type: "string", enum: ["add","remove"], description: "add or remove" },
        group:    { type: "string", description: "Group name e.g. 'Administrators'" },
        username: { type: "string", description: "Username to add or remove" },
      },
      required: ["action","group","username"],
    },
  },
] as const;
