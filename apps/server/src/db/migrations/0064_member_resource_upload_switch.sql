-- Member-permission switch for reading-resource uploads (fonts, dictionary
-- imports). Defaults open so existing instances keep their behavior; the
-- instance owner always bypasses.
ALTER TABLE instance ADD COLUMN allow_user_resource_upload INTEGER NOT NULL DEFAULT 1;
