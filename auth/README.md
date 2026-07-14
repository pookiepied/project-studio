# Auth Gate

Google OAuth authentication service with JWT token issuance for Cloudflare Workers.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create KV Namespace

```bash
wrangler kv namespace create "AUTH_KV"
wrangler kv namespace create "AUTH_KV" --preview
```

Update `wrangler.toml` with the generated IDs:

```toml
[[kv_namespaces]]
binding = "AUTH_KV"
id = "YOUR_PRODUCTION_ID"
preview_id = "YOUR_PREVIEW_ID"
```

### 3. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URIs (where Google redirects after login):
   - `http://localhost:3000/oauth/callback` (React dev)
   - `http://localhost:5173/oauth/callback` (Vite dev)
   - `http://localhost:1420/oauth/callback` (Tauri)
   - `https://example.com/oauth/callback` (Production)
4. Copy Client ID and Client Secret

Note: These redirect URIs are for Google OAuth, separate from CORS configuration.

### 4. Set Secrets

```bash
wrangler secret put JWT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

### 5. Configure Frontend URLs (CORS)

Edit `wrangler.toml` and set comma-separated URLs where your frontend sends API requests FROM:

```toml
FRONTEND_URL = "https://yourdomain.com,http://localhost:3000,http://localhost:5173,http://localhost:1420"
```

Common values:
- `http://localhost:3000` - React dev server
- `http://localhost:5173` - Vite dev server
- `http://localhost:1420` - Tauri application
- `https://example.com` - Production web app

Note: This is for CORS, separate from Google OAuth redirect URIs.

### 6. Add Whitelisted Users

```bash
npm run whitelist add user@example.com
npm run whitelist list
```

### 7. Deploy

```bash
npm run deploy
```

## Local Development

```bash
npm run dev
```

Create `.dev.vars` file:
```
JWT_SECRET=your_secret
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

## Frontend Integration

### How It Works

```
┌─────────────────┐
│  Your Frontend  │  (React/Tauri on localhost:3000, 5173, 1420, etc.)
│  (Web/Desktop)  │
└────────┬────────┘
         │ 1. User clicks "Login with Google"
         ▼
┌─────────────────┐
│  Google OAuth   │  (Google handles authentication)
└────────┬────────┘
         │ 2. Returns idToken
         ▼
┌─────────────────┐
│  Your Frontend  │  Receives idToken from Google
└────────┬────────┘
         │ 3. POST /google with idToken
         ▼
┌─────────────────┐
│   Auth Gate     │  (This Cloudflare Worker)
│  (This Service) │  - Validates idToken with Google
│                 │  - Checks email whitelist
│                 │  - Generates JWT tokens
└────────┬────────┘
         │ 4. Returns accessToken + sets refresh cookie
         ▼
┌─────────────────┐
│  Your Frontend  │  Uses accessToken for API calls
└─────────────────┘
```

### Two Separate Configurations

**1. Google OAuth Redirect URIs** (in Google Console)
- Where Google redirects AFTER user logs in
- Examples: `http://localhost:3000/oauth/callback`, `https://example.com/oauth/callback`

**2. FRONTEND_URL (CORS)** (in wrangler.toml)
- Where your frontend sends API requests FROM
- Examples: `http://localhost:3000`, `https://example.com`

### Authentication Flow

1. **User clicks "Login with Google"** in your frontend
2. **Frontend initiates Google OAuth** (using Google's SDK or popup)
3. **Google authenticates user** and returns `idToken`
4. **Frontend sends idToken to Auth Gate**:

```javascript
const response = await fetch('https://your-auth-worker.workers.dev/google', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important: sends/receives cookies
  body: JSON.stringify({ idToken })
});

const data = await response.json();
// data.accessToken - Use for API calls
// data.user - User information
// Refresh token is in HTTP-only cookie
```

5. **Use accessToken for API calls**:

```javascript
const apiResponse = await fetch('https://your-api.com/endpoint', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

6. **Refresh token when expired**:

```javascript
const refreshResponse = await fetch('https://your-auth-worker.workers.dev/refresh', {
  method: 'POST',
  credentials: 'include' // Sends refresh token cookie
});

const { accessToken } = await refreshResponse.json();
```

### Frontend Setup Examples

#### React (Vite) - localhost:5173
```javascript
// Make sure FRONTEND_URL includes: http://localhost:5173
const AUTH_URL = 'https://your-auth-worker.workers.dev';
```

#### React (CRA) - localhost:3000
```javascript
// Make sure FRONTEND_URL includes: http://localhost:3000
const AUTH_URL = 'https://your-auth-worker.workers.dev';
```

#### Tauri - localhost:1420
```javascript
// Make sure FRONTEND_URL includes: http://localhost:1420
// Tauri uses a local server for OAuth callback
const AUTH_URL = 'https://your-auth-worker.workers.dev';
```

#### Production (Web)
```javascript
// Make sure FRONTEND_URL includes: https://example.com
const AUTH_URL = 'https://your-auth-worker.workers.dev';
```

### Google OAuth Setup

In your frontend, use Google's OAuth library:

```javascript
// Example using @react-oauth/google
import { GoogleLogin } from '@react-oauth/google';

<GoogleLogin
  onSuccess={(credentialResponse) => {
    // Send credentialResponse.credential (idToken) to Auth Gate
    authenticateWithAuthGate(credentialResponse.credential);
  }}
  onError={() => {
    console.log('Login Failed');
  }}
/>
```

## API Endpoints

### POST /google
Exchange Google ID token for JWT tokens.

Request:
```json
{
  "idToken": "google_id_token"
}
```

Response:
```json
{
  "accessToken": "jwt_access_token",
  "expiresIn": 3600,
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "profile_url",
    "role": "user"
  }
}
```

Note: Refresh token is set as HTTP-only cookie.

### POST /refresh
Refresh access token using refresh token cookie.

Response:
```json
{
  "accessToken": "new_jwt_access_token",
  "expiresIn": 3600
}
```

### POST /logout
Clear refresh token cookie.

### GET /me
Get current user information (requires Bearer token).

### GET /health
Health check endpoint.

## Whitelist Management

```bash
npm run whitelist add user@example.com
npm run whitelist remove user@example.com
npm run whitelist list
npm run whitelist check user@example.com
```

## Configuration

### Environment Variables (wrangler.toml)
- `ENVIRONMENT`: "production" or "development"
- `FRONTEND_URL`: Comma-separated list of allowed origins

### Secrets (wrangler secret put)
- `JWT_SECRET`: JWT signing secret
- `GOOGLE_CLIENT_ID`: Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth Client Secret

## Security Features

- Email whitelist validation
- JWT token signing with HMAC-SHA256
- HTTP-only cookies with SameSite=Strict
- CORS protection with configurable origins
- Rate limiting (5 req/min for login, 10 req/min for refresh)
- Input validation and sanitization
- Token expiration enforcement

## Token Lifecycle

- Access Token: 1 hour expiry, stored in frontend memory
- Refresh Token: 7 days expiry, stored in HTTP-only cookie

## Troubleshooting

### Email not whitelisted
```bash
npm run whitelist add user@example.com
```

### CORS error
Verify FRONTEND_URL includes your frontend origin (with protocol for localhost).

### Rate limit exceeded
Wait 1 minute before retrying.

## Project Structure

```
src/
  index.ts              Main application
  middleware/
    rateLimit.ts        Rate limiting
  services/
    google.ts           Google OAuth verification
    jwt.ts              JWT operations
    user.ts             User management
    whitelist.ts        Whitelist management
  types/
    index.ts            TypeScript types
  utils/
    validation.ts       Input validation
```
