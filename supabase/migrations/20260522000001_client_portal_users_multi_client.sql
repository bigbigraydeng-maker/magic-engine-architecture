-- Allow one email to access multiple clients (drop single-client UNIQUE constraint)
ALTER TABLE client_portal_users DROP CONSTRAINT IF EXISTS client_portal_users_email_key;
