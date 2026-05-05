<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// ── GET MY PROFILE ────────────────────────────────────────────
if ($action === 'get') {
    json_out(['user' => $me]);
}

// ── UPDATE MY PROFILE ─────────────────────────────────────────
if ($action === 'update') {
    $name        = trim(post('name',        $me['name']));
    $institution = trim(post('institution', $me['institution'] ?? ''));
    $cadre       = post('cadre',            $me['cadre']);
    $bio         = trim(post('bio',         $me['bio'] ?? ''));

    if (!$name) err('Name cannot be empty');

    $db->prepare(
        'UPDATE users SET name = ?, institution = ?, cadre = ?, bio = ? WHERE id = ?'
    )->execute([$name, $institution, $cadre, $bio, $me['id']]);

    json_out([
        'user' => array_merge($me, [
            'name'        => $name,
            'institution' => $institution,
            'cadre'       => $cadre,
            'bio'         => $bio,
        ]),
    ]);
}

// ── CHANGE PASSWORD ───────────────────────────────────────────
if ($action === 'change_password') {
    $old_pwd = post('old_password', '');
    $new_pwd = post('new_password', '');

    if (!$old_pwd || !$new_pwd) err('Both old and new passwords are required');
    if (strlen($new_pwd) < 6) err('New password must be at least 6 characters');

    $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$me['id']]);
    $hash = $stmt->fetchColumn();

    if (!password_verify($old_pwd, $hash)) err('Current password is incorrect');

    $new_hash = password_hash($new_pwd, PASSWORD_DEFAULT);
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$new_hash, $me['id']]);
    json_out(['ok' => true]);
}

err('Unknown action', 404);
