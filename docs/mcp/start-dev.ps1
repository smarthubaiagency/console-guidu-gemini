# MCP Server - Dev Startup Script
# Sets all required environment variables and launches the server.
# Redis is optional; MemoryStore is used if REDIS_URL is not set (dev only).

$env:MCP_S2S_SECRET    = "qT0sLxmUJo9JP9cXcKFw6gl3CMtIE7jp9X+DcR2sDRI="
$env:SUPABASE_URL      = "https://iznuotnsvjrbsvwhwysi.supabase.co"
$env:SUPABASE_JWKS_URL = "https://iznuotnsvjrbsvwhwysi.supabase.co/auth/v1/.well-known/jwks.json"
$env:SUPABASE_JWT_ISSUER   = "https://iznuotnsvjrbsvwhwysi.supabase.co/auth/v1"
$env:SUPABASE_JWT_AUDIENCE = "authenticated"
$env:DATABASE_URL = "postgresql://postgres.iznuotnsvjrbsvwhwysi:Zav1L7ZDss4E4nZw8GmWiSHwtUGG5flk@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"

Write-Host "Starting MCP server on :8080 ... (web app expects MCP_SERVER_URL=http://localhost:8080)" -ForegroundColor Cyan
.\mcp-server.exe
