INSERT INTO public.auth_providers (provider_name, description) VALUES
    ('email', 'Email and password authentication'),
    ('anonymous', 'Anonymous authentication'),
    ('google', 'Google OAuth'),
    ('github', 'GitHub OAuth'),
    ('discord', 'Discord OAuth');

INSERT INTO public.roles (role_name, description) VALUES
    ('guest', 'Default role for all users'),
    ('user', 'Authenticated user role'),
    ('admin', 'Administrative role');

-- Set up default admin credentials
DO $$
DECLARE
    admin_email TEXT := 'admin@vircadia.com';
    admin_password TEXT := 'CHANGE_ME!';
    admin_uuid UUID;
BEGIN
    -- Insert the admin user into auth.users
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        recovery_sent_at,
        last_sign_in_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        admin_email,
        crypt(admin_password, gen_salt('bf')),
        NOW(),
        NOW(),
        NOW(),
        '{"provider": "email", "providers": ["email"]}',
        '{"username": "admin", "full_name": "System Administrator"}',
        NOW(),
        NOW(),
        '',
        '',
        '',
        ''
    ) RETURNING id INTO admin_uuid;

    -- Create admin agent profile
    -- Note: The trigger will automatically add anonymous provider and guest role
    INSERT INTO agent_profiles (id, username)
    VALUES (admin_uuid, 'admin');

    -- Add email provider for admin
    INSERT INTO agent_auth_providers (agent_id, provider_name, is_primary)
    VALUES (admin_uuid, 'email', TRUE);

    -- Grant admin role
    INSERT INTO agent_roles (agent_id, role_name, granted_by)
    VALUES (admin_uuid, 'admin', admin_uuid);

    RAISE NOTICE 'Admin account created with UUID: %', admin_uuid;
END $$;

-- Add a note about changing the default admin password
DO $$
BEGIN
    RAISE NOTICE 'IMPORTANT: Remember to change the default admin password after first login!';
END $$;

-- Add the root "seed" entity first
INSERT INTO entities (
    general__uuid,
    general__name,
    general__type,
    general__semantic_version,
    general__transform,
    permissions__groups__read,
    permissions__groups__write,
    permissions__groups__execute
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'boot_to_vircadia_world',
    'MODEL',
    '1.0.0',
    ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
    ARRAY['*'],  -- All roles can read
    ARRAY['admin'],  -- Only admin can write
    ARRAY['admin']  -- Only admin can execute
);

-- Then add the associated script
INSERT INTO entity_scripts (
    entity_id,
    is_persistent,
    web__compiled__node__script,
    web__compiled__node__script_sha256,
    web__compiled__node__script_status,
    web__compiled__bun__script,
    web__compiled__bun__script_sha256,
    web__compiled__bun__script_status,
    web__compiled__browser__script,
    web__compiled__browser__script_sha256,
    web__compiled__browser__script_status,
    git_repo_entry_path,
    git_repo_url,
    permissions__groups__mutations,
    permissions__world_connection
) VALUES (
    '00000000-0000-0000-0000-000000000001',  -- References the entity we just created
    TRUE,  -- Make it persistent
    '',    -- Empty compiled scripts initially
    '',
    'PENDING',
    '',
    '',
    'PENDING',
    '',
    '',
    'PENDING',
    'seed/babylon/seed.ts',
    'https://github.com/vircadia/vircadia-world-sdk-ts/',
    ARRAY[]::TEXT[],
    FALSE
);
