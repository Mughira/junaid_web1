# Serve site + PHP contact form in one container
FROM php:8.2-apache

# Install Composer and deps for PHPMailer (openssl is usually already in php image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    unzip \
    libzip-dev \
    && docker-php-ext-install -j$(nproc) zip \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Copy app (excluding what's in .dockerignore)
COPY . .

# Install PHP deps (PHPMailer)
RUN composer install --no-dev --no-interaction

# Apache serves from /var/www/html; allow .htaccess if present
RUN a2enmod rewrite headers 2>/dev/null || true

EXPOSE 80
