<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// ── LIST COURSES ─────────────────────────────────────────────
if ($action === 'list') {
    if ($me['role'] === 'admin') {
        $courses = $db->query('SELECT * FROM courses ORDER BY title ASC')->fetchAll();
    } else {
        $stmt = $db->prepare('SELECT * FROM courses WHERE cadre = ? ORDER BY title ASC');
        $stmt->execute([$me['cadre']]);
        $courses = $stmt->fetchAll();
    }

    foreach ($courses as &$course) {
        // Topic count
        $tc = $db->prepare('SELECT COUNT(*) FROM topics WHERE course_id = ?');
        $tc->execute([$course['id']]);
        $course['topic_count'] = (int)$tc->fetchColumn();

        // Completed by current user
        $cc = $db->prepare(
            'SELECT COUNT(*) FROM topic_completions tc
               JOIN topics t ON t.id = tc.topic_id
              WHERE t.course_id = ? AND tc.user_id = ?'
        );
        $cc->execute([$course['id'], $me['id']]);
        $course['completed_count'] = (int)$cc->fetchColumn();
    }
    unset($course);

    json_out(['courses' => $courses]);
}

// ── GET TOPICS FOR A COURSE ───────────────────────────────────
if ($action === 'topics') {
    $course_id = get('course_id', '');
    if (!$course_id) err('course_id required');

    $course = $db->prepare('SELECT * FROM courses WHERE id = ?');
    $course->execute([$course_id]);
    $c = $course->fetch();
    if (!$c) err('Course not found', 404);

    $stmt = $db->prepare('SELECT id, title, type, sort_order FROM topics WHERE course_id = ? ORDER BY sort_order ASC');
    $stmt->execute([$course_id]);
    $topics = $stmt->fetchAll();

    // Mark which ones the user completed
    foreach ($topics as &$t) {
        $done = $db->prepare('SELECT 1 FROM topic_completions WHERE user_id = ? AND topic_id = ?');
        $done->execute([$me['id'], $t['id']]);
        $t['completed'] = (bool)$done->fetchColumn();
    }
    unset($t);

    json_out(['course' => $c, 'topics' => $topics]);
}

// ── GET TOPIC CONTENT ─────────────────────────────────────────
if ($action === 'topic') {
    $topic_id = get('topic_id', '');
    if (!$topic_id) err('topic_id required');

    $stmt = $db->prepare('SELECT t.*, c.title AS course_title FROM topics t JOIN courses c ON c.id = t.course_id WHERE t.id = ?');
    $stmt->execute([$topic_id]);
    $t = $stmt->fetch();
    if (!$t) err('Topic not found', 404);

    $done = $db->prepare('SELECT 1 FROM topic_completions WHERE user_id = ? AND topic_id = ?');
    $done->execute([$me['id'], $topic_id]);
    $t['completed'] = (bool)$done->fetchColumn();

    json_out(['topic' => $t]);
}

// ── MARK TOPIC COMPLETE ───────────────────────────────────────
if ($action === 'complete') {
    $topic_id = post('topic_id', '');
    if (!$topic_id) err('topic_id required');

    $db->prepare(
        'INSERT IGNORE INTO topic_completions (user_id, topic_id) VALUES (?, ?)'
    )->execute([$me['id'], $topic_id]);

    json_out(['ok' => true]);
}

err('Unknown action', 404);
