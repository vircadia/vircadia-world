INSERT INTO public.auth_providers (auth__provider_name, meta__description, auth__is_active) VALUES
    ('email', 'Email and password authentication', TRUE),
    ('anonymous', 'Anonymous authentication', TRUE),
    ('google', 'Google OAuth', TRUE),
    ('github', 'GitHub OAuth', TRUE),
    ('discord', 'Discord OAuth', TRUE);

INSERT INTO public.roles (
    auth__role_name, 
    meta__description, 
    auth__is_system, 
    auth__is_active,
    auth__entity__object__can_insert,
    auth__entity__script__can_insert
) VALUES
    ('guest', 'Default role for all users', TRUE, TRUE, FALSE, FALSE),
    ('user', 'Authenticated user role', TRUE, TRUE, TRUE, TRUE),
    ('admin', 'Administrative role', TRUE, TRUE, TRUE, TRUE);

-- Set up default admin credentials
DO $$
DECLARE
    admin_email TEXT := 'admin@changeme.com';
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
    INSERT INTO agent_profiles (general__uuid, profile__username)
    VALUES (admin_uuid, 'admin');

    -- Add email provider for admin
    INSERT INTO agent_auth_providers (auth__agent_id, auth__provider_name, auth__is_primary)
    VALUES (admin_uuid, 'email', TRUE);

    -- Grant admin role
    INSERT INTO agent_roles (auth__agent_id, auth__role_name, auth__granted_by)
    VALUES (admin_uuid, 'admin', admin_uuid);

    RAISE NOTICE 'Admin account created with UUID: %', admin_uuid;
END $$;

-- Add a note about changing the default admin password
DO $$
BEGIN
    RAISE NOTICE 'IMPORTANT: Remember to change the default admin password after first login!';
END $$;
