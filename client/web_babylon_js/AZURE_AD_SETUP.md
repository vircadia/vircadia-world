# Azure AD Setup Guide

This guide explains how to set up Azure Active Directory (Azure AD) authentication for Vircadia.

## Prerequisites

- An Azure account with access to Azure Active Directory
- Access to the Vircadia database to configure the auth provider

## Azure AD App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Configure the application:
   - **Name**: Vircadia Web Client (or your preferred name)
   - **Supported account types**: Choose based on your needs:
     - Single tenant (your organization only)
     - Multi-tenant (any Azure AD tenant)
     - Personal Microsoft accounts
   - **Redirect URI**: 
     - Platform: **Web**
     - URI: `http://localhost:3020/api/auth/oauth/callback` (for local development)
     - For production: `https://your-api-domain.com/api/auth/oauth/callback`

5. After registration, note down:
   - **Application (client) ID**
   - **Directory (tenant) ID**

6. Create a client secret:
   - Go to **Certificates & secrets**
   - Click **New client secret**
   - Add a description and set expiration
   - **Copy the secret value immediately** (it won't be shown again)

## Database Configuration

The Azure AD provider needs to be configured in the database. Insert the following into the `auth.auth_providers` table:

```sql
INSERT INTO auth.auth_providers (
    provider__name,
    provider__enabled,
    provider__client_id,
    provider__client_secret,
    provider__redirect_uris,
    provider__scope,
    provider__jwt_secret,
    provider__metadata
) VALUES (
    'azure',
    true,
    'YOUR_CLIENT_ID_HERE',
    'YOUR_CLIENT_SECRET_HERE',
    ARRAY['http://localhost:3020/api/auth/oauth/callback'], -- Update for production
    ARRAY['openid', 'profile', 'email', 'User.Read'],
    'YOUR_JWT_SECRET_HERE', -- Generate a secure random string
    jsonb_build_object('tenant_id', 'YOUR_TENANT_ID_HERE')
);
```

Replace:
- `YOUR_CLIENT_ID_HERE` with your Application (client) ID
- `YOUR_CLIENT_SECRET_HERE` with your client secret
- `YOUR_TENANT_ID_HERE` with your Directory (tenant) ID
- `YOUR_JWT_SECRET_HERE` with a secure random string (e.g., generate with `openssl rand -base64 32`)

## OAuth Flow

The authentication flow works as follows:

1. **Frontend initiates login**: User clicks "Sign in with Microsoft"
2. **Get authorization URL**: Frontend requests authorization URL from backend
3. **Redirect to Azure AD**: Backend generates URL and redirects user to Azure AD
4. **User authenticates**: User signs in with their Microsoft account
5. **Callback to backend**: Azure AD redirects to backend with authorization code
6. **Token exchange**: Backend exchanges code for tokens
7. **Session creation**: Backend creates session and returns JWT
8. **Return to frontend**: User is redirected back to the application with session

## Environment Variables

No environment variables are needed in the frontend for Azure AD configuration. All configuration is stored securely in the database and handled by the backend.

## API Endpoints

The following endpoints handle the OAuth flow:

- `GET /api/auth/oauth/authorize?provider=azure` - Get authorization URL
- `GET /api/auth/oauth/callback?code=...&state=...&provider=azure` - OAuth callback
- `POST /api/auth/logout` - Sign out
- `POST /api/auth/link-provider` - Link Azure AD to existing account
- `POST /api/auth/unlink-provider` - Unlink Azure AD from account
- `GET /api/auth/list-providers?sessionId=...` - List linked providers

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI" error**
   - Ensure the redirect URI in Azure AD matches exactly what's in the database
   - Check for trailing slashes, protocol (http vs https), and port numbers

2. **"Invalid client credentials" error**
   - Verify the client ID and secret are correctly stored in the database
   - Check that the secret hasn't expired in Azure AD

3. **"Tenant not found" error**
   - Verify the tenant ID in the database metadata
   - Use "common" as tenant ID for multi-tenant apps

4. **CORS errors**
   - The backend should handle CORS for the API endpoints
   - Frontend and backend should be on allowed origins

### Debug Mode

To enable debug logging for Azure AD authentication:
1. Set `VRCA_SERVER_DEBUG=true` in your server environment
2. Check server logs for detailed MSAL and authentication flow information

## Security Considerations

1. **Client Secret**: Never expose the client secret in frontend code
2. **HTTPS**: Always use HTTPS in production for redirect URIs
3. **JWT Secret**: Use a strong, unique secret for JWT signing
4. **Session Management**: Implement proper session expiration and refresh
5. **Scope Limitations**: Only request necessary scopes

## Multi-Provider Support

Users can link multiple authentication providers to their account:
- Primary provider used for initial registration
- Additional providers can be linked via `/api/auth/link-provider`
- Users can unlink providers (except the last one) via `/api/auth/unlink-provider` 