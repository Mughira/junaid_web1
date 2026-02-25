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
    $mail->isHTML(true);

    // Escape for HTML and prepare message with line breaks
    $nameH    = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    $emailH   = htmlspecialchars($email, ENT_QUOTES, 'UTF-8');
    $phoneH   = htmlspecialchars($phone, ENT_QUOTES, 'UTF-8');
    $subjectH = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');
    $messageH = nl2br(htmlspecialchars($message, ENT_QUOTES, 'UTF-8'));

    $htmlBody = '<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New contact form submission</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:\'Segoe UI\', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f5; padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.08); overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding:32px 40px; text-align:center;">
              <h1 style="margin:0; font-size:24px; font-weight:600; color:#ffffff; letter-spacing:-0.5px;">New Contact Message</h1>
              <p style="margin:8px 0 0; font-size:14px; color:rgba(255,255,255,0.85);">Someone reached out from your website</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 36px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:15px; line-height:1.6; color:#333333;">
                <tr>
                  <td style="padding:12px 0; border-bottom:1px solid #eee;">
                    <span style="display:inline-block; width:100px; font-weight:600; color:#6b7280;">Name</span>
                    <span style="color:#1a1a2e;">' . $nameH . '</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0; border-bottom:1px solid #eee;">
                    <span style="display:inline-block; width:100px; font-weight:600; color:#6b7280;">Email</span>
                    <a href="mailto:' . $emailH . '" style="color:#2563eb; text-decoration:none;">' . $emailH . '</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0; border-bottom:1px solid #eee;">
                    <span style="display:inline-block; width:100px; font-weight:600; color:#6b7280;">Phone</span>
                    <span style="color:#1a1a2e;">' . ($phoneH !== '' ? $phoneH : '—') . '</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0; border-bottom:1px solid #eee;">
                    <span style="display:inline-block; width:100px; font-weight:600; color:#6b7280;">Subject</span>
                    <span style="color:#1a1a2e;">' . $subjectH . '</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 0 0;">
                    <p style="margin:0 0 8px; font-weight:600; color:#6b7280;">Message</p>
                    <div style="padding:16px; background-color:#f8fafc; border-radius:8px; border-left:4px solid #2563eb; color:#374151;">' . $messageH . '</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px; background-color:#f8fafc; border-top:1px solid #eee; text-align:center; font-size:12px; color:#9ca3af;">
              This email was sent from your website contact form. Reply directly to respond to the sender.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>';

    $mail->Body = $htmlBody;
    $plainBody = "Name: {$name}\nEmail: {$email}\nPhone: {$phone}\nSubject: {$subject}\n\nMessage:\n{$message}";
    $mail->AltBody = $plainBody;

    $mail->send();
    echo json_encode(['ok' => true]);
} catch (Exception $e) {
    error_log('Contact form mail error: ' . $mail->ErrorInfo);
    echo json_encode(['ok' => false, 'error' => 'Unable to send email. Please try again later.']);
}
