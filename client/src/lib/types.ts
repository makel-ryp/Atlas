// The shape of GET /api/users/me. Hand-written rather than derived from eco's row types because the
// route returns a deliberate subset — firebase_uid and internal timestamps stay server-side.
export interface PlayerProfile {
  userId: string
  handicapIndex: string | null // numeric in Postgres -> string over the wire, never a float
  driverCarryYds: number | null
  handedness: string | null
  ghinNumber: string | null
  updatedAt: string | null
}

export interface Me {
  user: {
    id: string
    email: string
    displayName: string | null
    plan: string
    createdAt: string | null
  }
  roles: { app: string; role: string }[]
  profile: PlayerProfile | null
}

// The shapes of the /api/admin/* routes. Hand-written, same reasoning as Me above: these mirror a
// deliberate server-side subset, not the raw eco rows (no firebase_uid, no internal ids beyond what
// the admin screen needs to act on).
export interface AdminUser {
  id: string
  email: string
  displayName: string | null
  plan: string
  createdAt: string | null
  deletedAt: string | null
  appRoles: { app: string; role: string; revoked: boolean }[]
  orgs: { orgId: string; orgName: string; role: string; status: string }[]
}

export interface AdminOrg {
  id: string
  name: string
  type: string
  status: string
  plan: string
  license: string | null
  createdAt: string | null
  updatedAt: string | null
  memberCount: number
  coachCount: number
}

export interface AuditRow {
  id: string
  actorUserId: string
  actorDisplayName: string | null
  entity: string
  entityId: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  reason: string | null
  createdAt: string
}

// The shape of GET /api/coach/students.
export interface Student {
  userId: string
  displayName: string | null
  email: string
  status: string // 'active' | 'pending' | 'ended'
  source: 'direct' | 'academy'
  orgName: string | null
  profile: {
    userId: string
    handicapIndex: string | null
    driverCarryYds: number | null
    handedness: string | null
  } | null
  // null and [] are different: null means the metric tier withheld it (the student has not approved
  // this coach), [] means approved with nothing recorded yet. The UI must not render them the same.
  handicapTrend: { handicapIndex: string; recordedAt: string }[] | null
}
