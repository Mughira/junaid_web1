# Contact form – PHP SMTP mail

The contact form submits to `send_email.php`, which sends email via SMTP to **mughira.irfan17@gmail.com** using the settings in `mail_config.php`.

## Run with Docker (recommended – one command)

```bash
docker compose up --build
```

Then open **http://localhost:8080**. The site and contact form work in one flow (Composer runs during build; no local PHP needed).

## Run without Docker

1. **Install PHP dependencies** (one-time):

   ```bash
   composer install
   ```

   If you don’t have Composer: [getcomposer.org](https://getcomposer.org)

2. **Config**: `mail_config.php` is already set with your Hostinger SMTP. To change it later, edit that file or copy `mail_config.example.php` to `mail_config.php`.

3. **Server**: Serve the site with PHP (e.g. Apache/Nginx with PHP, or `php -S localhost:8000`). The form must be opened via HTTP so `send_email.php` can be requested.

## Files

- `send_email.php` – Form handler; sends POST data as email via SMTP.
- `mail_config.php` – SMTP credentials (do not commit; listed in `.gitignore`).
- `mail_config.example.php` – Example config for cloning the project.
