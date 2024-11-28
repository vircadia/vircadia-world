# Supabase

To debug and perform manual commands with Supabase CLI, use the following
command in the `app` directory:

```bash
bunx supabase --workdir $PWD [command]
```

## Configuration

You can configure the Supabase settings in `app/supabase/config.toml`. Also, you
may declare environment variables for the following:

- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (if using Supabase AI in Studio)
- `SENDGRID_API_KEY` (if using a production SMTP server)
- `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` (if using Twilio for SMS)
- `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` (if using Apple for external OAuth)
- `S3_HOST` (if using OrioleDB with S3)
- `S3_REGION` (if using OrioleDB with S3)
- `S3_ACCESS_KEY` (if using OrioleDB with S3)
- `S3_SECRET_KEY` (if using OrioleDB with S3)

## Maintenance

If you need to reset the database, all the data, and its structure, you can use
the following command:

```bash
bunx supabase --workdir $PWD db reset
```

Be careful with this command, as it will delete all existing data and cannot be
reversed.

## Types

If you update the schemas, you need to generate the types again. You can use the
following command:

```bash
bunx supabase --workdir $PWD gen types --lang=typescript --local > ../../../../sdk/vircadia-world-sdk-ts/schema/schema.database.ts
```
