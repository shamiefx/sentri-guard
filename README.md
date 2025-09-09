# Sentri Guard

Hybrid Ionic + Angular attendance / time tracking app with Firebase backend.

## Features
- Email/password registration with company code validation
- Punch In / Punch Out with:
  - Front camera selfie (base64 inline image for now)
  - High accuracy geolocation
  - Geofence enforcement (company center + radius)
- Single active session enforcement
- Auto restoration of active session after refresh/login
- Today total working time (aggregated)
- Today's Sessions list (multiple intervals) with live-updating active duration
- Recent punches history
- Offline queue (manual sync) for punch actions when network fails
- Company lookup via code (supports id or companyCode field)

## Tech Stack
- Ionic 8 / Angular 16+ (standalone components)
- Firebase (Auth, Firestore, Storage placeholder)
- Capacitor Camera & Geolocation
- AngularFire 7+ (modular API)

## Data Model (Firestore)
Collections:
- `users/{uid}`: { staffId, email, companyCode, createdAt }
- `companies/{companyId}`: { name, companyCode, geofenceCenter: { lat, lng }, geofenceRadiusMeters }
- `punches/{punchId}`: {
  userId, companyCode?, punchIn (ISO string), punchOut (ISO string|null),
  photoData (base64), location: { lat, lng, accuracy }, createdAt
}
Active session: `punchOut == null`.

## Geofence
Distance computed with Haversine formula; validation fails punch if outside radius.

## Offline Queue
Punch actions enqueued in `localStorage` when network errors occur. Manual Sync Now button replays them.

## Getting Started
```bash
# Install deps
npm install

# Serve (Ionic)
npm run start

# Open in browser (default http://localhost:8100)

# Sync native platforms (after adding ios / android)
npx cap sync
```

## Environment
Ensure Firebase config set in:
- `src/environments/environment.ts`
- `src/environments/environment.prod.ts`

## TODO / Next Enhancements
- Move photoData to Firebase Storage (store URL only)
- Auto offline sync with retry + exponential backoff
- Authentication guard + login page
- Firestore security rules & composite indexes
- Weekly / monthly reporting & export (CSV)
- App Check + performance monitoring
- Admin UI for company geofence configuration

## Scripts
Key scripts in `package.json`:
- `start`: ionic serve
- `build`: production build
- `test`: run unit tests (Karma)

## Contributing
1. Fork
2. Create feature branch
3. Commit changes with conventional message
4. Open Pull Request

## License
MIT (update if required)

---
Generated initial README; update with screenshots and finalized security rules when ready.
