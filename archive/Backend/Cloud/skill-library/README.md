# Studio Cloud Skill Library

The Studio Cloud Skill Library stores full cloud skill definitions. The Cloud
Library Registry stores searchable registration metadata such as name, slug,
status, ownership, version, tags, activation rules, and references.

Skills use the Anthropic skill structure:

```text
skills/<skill-id>/
  SKILL.md
```

The first bundled system skill is `product-self-knowledge`. It is concise by
design and should only contain information that is currently true about Studio.

## Ownership

- System skills are maintained by Studio and use `ownerType: "system"`.
- User-scoped skills are not user-facing yet, but the schema supports
  `ownerType: "user"` and `ownerUserId` for future isolated user libraries.

## Registry Boundary

The registry should store skill registration metadata:

- `id`
- `name`
- `slug`
- `description`
- `ownerType`
- `ownerUserId`
- `status`
- `currentVersion`
- `instructionsRef`
- `configRef`
- `activationRules`
- `requiredTools`
- `requiredPermissions`
- `resources`
- `mcpServerIds`

This library owns the full skill content and any future structured skill
configuration.
