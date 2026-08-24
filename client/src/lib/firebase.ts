import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

// Project rypstick-ios — the SAME project Red and Locker Room use, which is the whole basis of
// cross-app identity: firebase_uid is the key into public.users, so one person signing into any
// RYP app resolves to one row. Pointing Atlas at its own project would give the same human a
// different uid per app and quietly break every cross-app read.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

function getFirebaseApp(): FirebaseApp {
  return getApps()[0] ?? initializeApp(firebaseConfig)
}

let cached: Auth | null = null

export function getFirebaseAuth(): Auth {
  if (!cached) cached = getAuth(getFirebaseApp())
  return cached
}

export const auth = getFirebaseAuth()
