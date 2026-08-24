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
