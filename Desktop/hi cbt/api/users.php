<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');

// ── LIST ALL USERS (admin only) ───────────────────────────────
if ($action === 'list') {
    requireRole($me, ['admin']);
    $db    = getDB();
    $rows  = $db->query(
        'SELECT id, name, email, role, cadre, institution, bio, avatar_url, matric_no, joined_at
           FROM users ORDER BY joined_at DESC'
    )->fetchAll();
    json_out(['users' => $rows]);
}

// ── ADD USER (admin only) ─────────────────────────────────────
if ($action === 'add') {
    requireRole($me, ['admin']);

    $name        = trim(post('name', ''));
    $email       = strtolower(trim(post('email', '')));
    $password    = post('password', 'himvault2025');
    $role        = post('role', 'student');
    $cadre       = post('cadre', '');
    $institution = trim(post('institution', ''));

    if (!$name || !$email) err('Name and email are required');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) err('Invalid email address');

    $db = getDB();
    $check = $db->prepare('SELECT id FROM users WHERE email = ?');
    $check->execute([$email]);
    if ($check->fetch()) err('Email already exists');

    $matric = '';
    if ($role === 'student' && $cadre) {
        $prefix_map = ['Professional Diploma' => 'PD', 'National Diploma (ND)' => 'ND', 'HND/BSc' => 'BSC'];
        $prefix     = $prefix_map[$cadre] ?? 'STU';

        $db->beginTransaction();
        try {
            $db->prepare(
                'INSERT INTO matric_counters (cadre, counter) VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE counter = counter + 1'
            )->execute([$cadre]);
            $cnt    = $db->prepare('SELECT counter FROM matric_counters WHERE cadre = ?');
            $cnt->execute([$cadre]);
            $num    = (int)$cnt->fetchColumn();
            $matric = 'HIMV/' . $prefix . '/' . str_pad($num, 4, '0', STR_PAD_LEFT);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
        }
    }

    $id   = genId();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $db->prepare(
        'INSERT INTO users (id, name, email, password_hash, role, cadre, institution, matric_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$id, $name, $email, $hash, $role, $cadre, $institution, $matric]);

    json_out([
        'user'      => ['id' => $id, 'name' => $name, 'email' => $email, 'role' => $role,
                        'cadre' => $cadre, 'institution' => $institution, 'matric_no' => $matric,
                        'joined_at' => date('Y-m-d H:i:s')],
        'matric_no' => $matric,
    ]);
}

// ── TOGGLE ROLE (admin only) ──────────────────────────────────
if ($action === 'toggle_role') {
    requireRole($me, ['admin']);
    $uid  = post('user_id', '');
    if (!$uid) err('user_id required');

    $db   = getDB();
    $stmt = $db->prepare('SELECT role FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $row  = $stmt->fetch();
    if (!$row) err('User not found', 404);

    $roles = ['student', 'tutor', 'admin'];
    $next  = $roles[(array_search($row['role'], $roles) + 1) % 3];
    $db->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$next, $uid]);
    json_out(['new_role' => $next]);
}

err('Unknown action', 404);
