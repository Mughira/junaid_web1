<?php
/**
 * Contact form handler. Sends email via SMTP to mughira.irfan17@gmail.com.
 * Requires: composer install (PHPMailer)
 */
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$configPath = __DIR__ . '/mail_config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Mail configuration not found']);
    exit;
}

$config = require $configPath;
if (empty($config['EMAIL_ENABLED'])) {
    echo json_encode(['ok' => false, 'error' => 'Email is disabled']);
    exit;
}

$name    = isset($_POST['name']) ? trim((string) $_POST['name']) : '';
$email   = isset($_POST['email']) ? trim((string) $_POST['email']) : '';
$phone   = isset($_POST['phone']) ? trim((string) $_POST['phone']) : '';
$subject = isset($_POST['subject']) ? trim((string) $_POST['subject']) : '';
$message = isset($_POST['message']) ? trim((string) $_POST['message']) : '';

if ($name === '' || $email === '' || $subject === '' || $message === '') {
    echo json_encode(['ok' => false, 'error' => 'Please fill in all required fields.']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo json_encode(['ok' => false, 'error' => 'Invalid email address.']);
    exit;
}

$autoload = __DIR__ . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Please run: composer install']);
    exit;
}

require $autoload;

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

$mail = new PHPMailer(true);
try {
    $mail->isSMTP();
    $mail->Host       = $config['EMAIL_HOST'];
    $mail->SMTPAuth   = true;
    $mail->Username   = $config['EMAIL_USER'];
    $mail->Password   = $config['EMAIL_PASSWORD'];
    $mail->SMTPSecure = $config['EMAIL_SECURE'] ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port       = (int) $config['EMAIL_PORT'];
    $mail->CharSet    = 'UTF-8';

    $mail->setFrom($config['EMAIL_FROM'], 'Contact Form');
    $mail->addAddress($config['EMAIL_TO'] ?? 'mughira.irfan@mindmakr.com');
    $mail->addReplyTo($email, $name);

    $mail->Subject = 'New contact form: ' . $subject;
    $body = "Name: {$name}\n";
    $body .= "Email: {$email}\n";
    $body .= "Phone: {$phone}\n";
    $body .= "Subject: {$subject}\n\n";
    $body .= "Message:\n{$message}";
    $mail->Body = $body;
    $mail->AltBody = strip_tags(str_replace("\n", "\r\n", $body));

    $mail->send();
    echo json_encode(['ok' => true]);
} catch (Exception $e) {
    error_log('Contact form mail error: ' . $mail->ErrorInfo);
    echo json_encode(['ok' => false, 'error' => 'Unable to send email. Please try again later.']);
}
