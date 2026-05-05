<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// ── LIST GROUPS ───────────────────────────────────────────────
if ($action === 'list') {
    $groups = $db->query('SELECT g.*, u.name AS tutor_name FROM chat_groups g LEFT JOIN users u ON u.id = g.tutor_id ORDER BY g.created_at DESC')->fetchAll();

    foreach ($groups as &$g) {
        // Member count
        $mc = $db->prepare('SELECT COUNT(*) FROM group_members WHERE group_id = ?');
        $mc->execute([$g['id']]);
        $g['member_count'] = (int)$mc->fetchColumn();

        // Is current user a member or the tutor?
        $isMem = $db->prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?');
        $isMem->execute([$g['id'], $me['id']]);
        $g['is_member'] = (bool)$isMem->fetchColumn() || $g['tutor_id'] === $me['id'];

        // Last message preview
        $last = $db->prepare(
            'SELECT m.message_text, u.name AS sender_name
               FROM group_messages m JOIN users u ON u.id = m.user_id
              WHERE m.group_id = ? ORDER BY m.sent_at DESC LIMIT 1'
        );
        $last->execute([$g['id']]);
        $g['last_message'] = $last->fetch() ?: null;
    }
    unset($g);

    json_out(['groups' => $groups]);
}

// ── GET MESSAGES ─────────────────────────────────────────────
if ($action === 'messages') {
    $group_id = get('group_id', '');
    if (!$group_id) err('group_id required');

    $msgs = $db->prepare(
        'SELECT m.id, m.user_id, m.message_text, m.sent_at, u.name AS sender_name
           FROM group_messages m JOIN users u ON u.id = m.user_id
          WHERE m.group_id = ? ORDER BY m.sent_at ASC LIMIT 200'
    );
    $msgs->execute([$group_id]);
    json_out(['messages' => $msgs->fetchAll()]);
}

// ── JOIN GROUP ────────────────────────────────────────────────
if ($action === 'join') {
    $group_id = post('group_id', '');
    if (!$group_id) err('group_id required');

    $db->prepare('INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)')->execute([$group_id, $me['id']]);
    json_out(['ok' => true]);
}

// ── SEND MESSAGE ─────────────────────────────────────────────
if ($action === 'send') {
    $group_id = post('group_id', '');
    $text     = trim(post('text', ''));
    if (!$group_id || !$text) err('group_id and text required');

    // Must be a member or tutor of this group
    $isMem = $db->prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?');
    $isMem->execute([$group_id, $me['id']]);
    $isTutor = $db->prepare('SELECT 1 FROM chat_groups WHERE id = ? AND tutor_id = ?');
    $isTutor->execute([$group_id, $me['id']]);
    if (!$isMem->fetchColumn() && !$isTutor->fetchColumn() && $me['role'] !== 'admin')
        err('You are not a member of this group');

    $id = genId();
    $db->prepare('INSERT INTO group_messages (id, group_id, user_id, message_text) VALUES (?, ?, ?, ?)')->execute([$id, $group_id, $me['id'], $text]);

    json_out(['message' => ['id' => $id, 'group_id' => $group_id, 'user_id' => $me['id'], 'message_text' => $text, 'sender_name' => $me['name'], 'sent_at' => date('Y-m-d H:i:s')]]);
}

// ── CREATE GROUP (tutor / admin) ──────────────────────────────
if ($action === 'create') {
    requireRole($me, ['tutor', 'admin']);

    $name     = trim(post('name', ''));
    $type     = post('type', 'general');
    $cadre    = post('cadre', '');
    if (!$name) err('Group name is required');

    $id = genId();
    $db->prepare(
        'INSERT INTO chat_groups (id, name, type, cadre, tutor_id) VALUES (?, ?, ?, ?, ?)'
    )->execute([$id, $name, $type, $cadre, $me['id']]);

    json_out([
        'group' => ['id' => $id, 'name' => $name, 'type' => $type, 'cadre' => $cadre,
                    'tutor_id' => $me['id'], 'member_count' => 0, 'is_member' => true],
    ]);
}

err('Unknown action', 404);
