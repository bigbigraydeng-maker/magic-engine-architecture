#!/bin/bash

# Get Supabase credentials from .env.local
SUPABASE_URL=$(grep "^NEXT_PUBLIC_SUPABASE_URL=" .env.local | cut -d= -f2)
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d= -f2)

echo "🔍 Checking Supabase migration status..."
echo "URL: $SUPABASE_URL"

# Try to check if column exists by querying the table
echo ""
echo "Attempting to query ai_visibility_runs table..."
curl -s -X GET "$SUPABASE_URL/rest/v1/ai_visibility_runs?limit=0" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "apikey: $SUPABASE_KEY" \
  | head -100
