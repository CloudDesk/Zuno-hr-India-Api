# Skills Module API

This document covers the backend foundation for the Skills module with taxonomy:

`Vertical -> Domain -> Skill`

And employee mapping:

`EmployeeSkill`

## Collections

- `verticals`
- `domains`
- `skills`
- `employeeSkills`

## Key Behaviors

- `isActive` is used for activation/deactivation of master data.
- No hard delete for `Vertical`, `Domain`, and `Skill`.
- `normalizedKey` is auto-generated from skill name if not provided.
- `aliases` are trimmed, normalized, and deduplicated.
- `EmployeeSkill` is unique for `{ employeeId, skillId }`.
- Pagination and sort are supported on all list endpoints.

## Endpoints

### Vertical

- `POST /verticals`
- `GET /verticals`
- `GET /verticals/:id`
- `PUT /verticals/:id`
- `PATCH /verticals/:id/status`

### Domain

- `POST /domains`
- `GET /domains` (filters: `verticalId`, `isActive`, `search`)
- `GET /domains/:id`
- `PUT /domains/:id`
- `PATCH /domains/:id/status`

### Skill

- `POST /skills`
- `GET /skills` (filters: `domainId`, `verticalId`, `search`, `isActive`)
- `GET /skills/:id`
- `PUT /skills/:id`
- `PATCH /skills/:id/status`

### Employee Skill

- `POST /employee-skills`
- `GET /employee-skills` (filters: `employeeId`, `skillId`, `domainId`, `verticalId`, `proficiencyLevel`, `isCertified`)
- `GET /employee-skills/:id`
- `PUT /employee-skills/:id`
- `DELETE /employee-skills/:id`
- `GET /employees/:employeeId/skills` (optional `grouped=true` for `Vertical > Domain > Skill`)

## Response Shape

All module endpoints return a consistent structure:

```json
{
  "success": true,
  "message": "Readable status message",
  "data": {},
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  }
}
```

Error response:

```json
{
  "success": false,
  "message": "Validation or business error message",
  "error": {}
}
```

## Optional Seed

Run:

```bash
npm run seed:skills-module
```

Seed includes:

- IT & Software -> Salesforce -> Apex, LWC
- Cloud & Infrastructure -> Azure -> Azure VNet, Azure Functions
- Manufacturing Operations -> CNC Operations -> CNC Programming, Machine Setup
