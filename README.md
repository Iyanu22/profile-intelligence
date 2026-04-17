# Profile Intelligence Service

A REST API that enriches names using Genderize, Agify, and Nationalize APIs and stores the results in a database.

## Live URL
https://profile-intelligence-production-be81.up.railway.app

## Endpoints

### POST /api/profiles
Creates a new profile. Returns existing profile if name already exists.

**Request body:**
{ "name": "John" }

### GET /api/profiles
Returns all profiles. Supports optional filters: gender, country_id, age_group.

**Example:** /api/profiles?gender=male&country_id=NG

### GET /api/profiles/:id
Returns a single profile by ID.

### DELETE /api/profiles/:id
Deletes a profile. Returns 204 No Content.

## Tech Stack
- Node.js
- Express
- SQLite (better-sqlite3)
- UUID v7