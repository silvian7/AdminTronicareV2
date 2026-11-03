# Admin on VPS5

This standalone deployment runs the production Admin image behind the VPS's Nginx HTTPS listener. Admin binds only `127.0.0.1:8080`. Its Redis has no published port and stores disposable, encrypted sessions. Restarting Redis signs users out. Business services and databases are not deployed by this base file. For the optional caregiver API, follow [CARE.md](CARE.md).

Use Docker Engine with Compose v2, Python 3, Nginx, a verified hostname and a valid TLS certificate. The intended hostname for this installation is `admin.tronicare.com`. Confirm port 8080 and the hostname are available before installation. This configuration assumes Nginx is the only HTTP proxy; it overwrites `X-Forwarded-For` and Admin trusts exactly one hop.

Copy `compose.yaml` to `/opt/tronicare-admin/compose.yaml`. Create a private `/opt/tronicare-admin/private/admin.env` from `env.example`, owned by the deployment operator and mode `0600`. Set the exact HTTPS `PUBLIC_ORIGIN`, generate a new session key with `openssl rand -base64 32`, and verify the service origins, write-enabled services and caregiver role ID. Keep the same key across Admin replicas and releases. Production rejects HTTP origins. Local development environment files contain local-only routes and must not be copied wholesale. Actual local release files belong under ignored `.local/`.

Build the production Dockerfile from the validated commit. Transfer a `docker save` archive and use `docker load` on VPS5, or pull a registry image by digest. Keep the full immutable image ID/digest; mutable image tags are not release identifiers. `pull_policy: never` requires the selected Admin image to be present before activation. Fetch the pinned Redis image separately if absent. Archive loading may retain the exact image ID without a registry digest mapping; in that case set `SESSIONS_IMAGE` to the verified full `sha256:` ID shown in `release.env.example`. This preserves the pinned image bytes and avoids a registry pull. The default remains the registry digest.

Create `/opt/tronicare-admin/releases/<release>.env` from `release.env.example`, using the full `sha256:<image-id>` or `repository@sha256:<digest>` and an absolute `ADMIN_ENV_FILE`. Retain previous release files and images for rollback. The following commands use a concrete release file selected by the operator:

```sh
release=/opt/tronicare-admin/releases/<release>.env
image=$(docker compose --env-file "$release" -f /opt/tronicare-admin/compose.yaml config --no-env-resolution --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["admin"]["image"])')
printf '%s\n' "$image" | grep -Eq '^(sha256:[0-9a-f]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[0-9a-f]{64})$' || {
  printf '%s\n' 'ADMIN_IMAGE must be an immutable image ID or digest' >&2
  exit 1
}
docker image inspect "$image" --format '{{.Id}}'
docker compose --env-file "$release" -f /opt/tronicare-admin/compose.yaml config --quiet
docker compose --env-file "$release" -f /opt/tronicare-admin/compose.yaml up -d --wait --wait-timeout 120
curl --fail http://127.0.0.1:8080/health/ready
```

Do not print resolved Compose configuration: it includes the private runtime values. `config --quiet` validates without exposing them. The required interpolation variables prevent an unset image or runtime-file path, while the image check above rejects mutable tags.

Replace every `__ADMIN_HOST__` in `nginx.conf.template` with the verified DNS hostname. Its certificate paths assume Certbot's `/etc/letsencrypt/live/<hostname>/` layout; the certificate for this installation is `/etc/letsencrypt/live/admin.tronicare.com/`. Retain `/var/www/tronicare-admin-acme` as the ACME webroot. Obtain the certificate with an HTTP-only bootstrap server if no certificate exists yet. Install this as a dedicated Nginx site without replacing other virtual hosts, run `sudo nginx -t`, then reload Nginx. Validate HTTPS `/`, `/care`, `/health/live`, `/health/ready` and the anonymous `/api/session` response through the real hostname. Readiness verifies Redis; upstream business-service authorization requires separate validation with an authorized account.

To roll back Admin, select the prior release file and run the same Compose command; keep Redis running:

```sh
previous=/opt/tronicare-admin/releases/<previous-release>.env
docker compose --env-file "$previous" -f /opt/tronicare-admin/compose.yaml config --quiet
docker compose --env-file "$previous" -f /opt/tronicare-admin/compose.yaml up -d --no-deps --wait --wait-timeout 120 admin
curl --fail http://127.0.0.1:8080/health/ready
```

If deployment used the caregiver overlay, include both Compose files on subsequent start and rollback commands, as described in `CARE.md`. Preserve the existing private runtime file and session key; changing the key invalidates existing sessions. No database migration is part of an Admin image update.
