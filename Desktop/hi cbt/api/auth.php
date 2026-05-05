<?php
require_once __DIR__ . '/config.php';

$action = post('action') ?? get('action');

// ── LOGIN ─────────────────────────────────────────────────────
if ($action === 'login') {
    $email    = trim(post('email', ''));
    $password = post('password', '');
    if (!$email || !$password) err('Email and password are required');

    $db   = getDB();
    $stmt = $db->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        err('Invalid email or password');
    }

    $_SESSION['user_id'] = $user['id'];
    unset($user['password_hash']);
    json_out(['user' => $user]);
}

// ── REGISTER ─────────────────────────────────────────────────
if ($action === 'register') {
    $name        = trim(post('name', ''));
    $email       = strtolower(trim(post('email', '')));
    $password    = post('password', '');
    $cadre       = post('cadre', '');
    $institution = trim(post('institution', ''));

    if (!$name || !$email || !$password || !$cadre || !$institution)
        err('Please fill in all fields');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        err('Invalid email address');
    if (strlen($password) < 6)
        err('Password must be at least 6 characters');

    $db = getDB();

    // Check duplicate email
    $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) err('Email already registered. Please sign in.');

    // Matric number generation — atomic counter update
    $prefix_map = [
        'Professional Diploma' => 'PD',
        'National Diploma (ND)' => 'ND',
        'HND/BSc' => 'BSC',
    ];
    $prefix = $prefix_map[$cadre] ?? 'STU';

    $db->beginTransaction();
    try {
        $db->prepare(
            'INSERT INTO matric_counters (cadre, counter) VALUES (?, 1)
             ON DUPLICATE KEY UPDATE counter = counter + 1'
        )->execute([$cadre]);

        $counter = $db->prepare('SELECT counter FROM matric_counters WHERE cadre = ?');
        $counter->execute([$cadre]);
        $num      = (int)$counter->fetchColumn();
        $matric   = 'HIMV/' . $prefix . '/' . str_pad($num, 4, '0', STR_PAD_LEFT);

        $id   = genId();
        $hash = password_hash($password, PASSWORD_DEFAULT);

        $db->prepare(
            'INSERT INTO users (id, name, email, password_hash, role, cadre, institution, matric_no)
             VALUES (?, ?, ?, ?, \'student\', ?, ?, ?)'
        )->execute([$id, $name, $email, $hash, $cadre, $institution, $matric]);

        $db->commit();

        $_SESSION['user_id'] = $id;
        json_out([
            'user' => [
                'id'          => $id,
                'name'        => $name,
                'email'       => $email,
                'role'        => 'student',
                'cadre'       => $cadre,
                'institution' => $institution,
                'bio'         => '',
                'avatar_url'  => null,
                'matric_no'   => $matric,
                'joined_at'   => date('Y-m-d H:i:s'),
            ],
            'matric_no' => $matric,
        ]);
    } catch (Throwable $e) {
        $db->rollBack();
        err('Registration failed. Please try again.');
    }
}

// ── LOGOUT ───────────────────────────────────────────────────
if ($action === 'logout') {
    session_destroy();
    json_out(['ok' => true]);
}

// ── ME (get current session user) ────────────────────────────
if ($action === 'me') {
    $user = requireAuth();
    json_out(['user' => $user]);
}

err('Unknown action', 404);
