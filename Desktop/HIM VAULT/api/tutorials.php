<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// ── SCHEMA ────────────────────────────────────────────────────────
$db->exec("CREATE TABLE IF NOT EXISTS tutorial_categories (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    icon        VARCHAR(20)  DEFAULT '📚',
    sort_order  INT          DEFAULT 0,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$db->exec("CREATE TABLE IF NOT EXISTS tutorial_questions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT  NOT NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    sort_order  INT  DEFAULT 0,
    published   TINYINT(1) DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cat (category_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$db->exec("CREATE TABLE IF NOT EXISTS tutorial_progress (
    user_id     INT NOT NULL,
    question_id INT NOT NULL,
    viewed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, question_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$db->exec("CREATE TABLE IF NOT EXISTS tutorial_notifications (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    category_id INT          NOT NULL,
    message     VARCHAR(255) NOT NULL,
    is_read     TINYINT(1)   DEFAULT 0,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

// ── SEED STARTER CATEGORIES ───────────────────────────────────────
$cnt = (int)$db->query("SELECT COUNT(*) FROM tutorial_categories")->fetchColumn();
if ($cnt === 0) {
    $seeds = [
        ['Health Records Management', 'Core concepts of managing patient health information and records',   '🏥', 1],
        ['Clinical Coding',           'Principles and practices of ICD and procedural coding',             '🔢', 2],
        ['Medical Terminology',       'Medical prefixes, suffixes, roots and standard language',           '📖', 3],
        ['ICD-10 Coding',             'International Classification of Diseases 10th revision guidelines', '📋', 4],
        ['Health Data & Statistics',  'Collection, analysis and presentation of health data',              '📊', 5],
        ['Medical Ethics & Law',      'Patient rights, confidentiality and legal frameworks in HIM',       '⚖️', 6],
    ];
    $ins = $db->prepare("INSERT INTO tutorial_categories (name,description,icon,sort_order) VALUES (?,?,?,?)");
    foreach ($seeds as $s) $ins->execute($s);
}

$isPrivileged = in_array($me['role'], ['admin', 'tutor']);
$isAdmin      = $me['role'] === 'admin';

// ── HELPER: notify members who have started a category ────────────
function notifyStartedMembers(PDO $db, int $catId, int $excludeUserId, string $message): void {
    $stmt = $db->prepare(
        "SELECT DISTINCT tp.user_id FROM tutorial_progress tp
         JOIN tutorial_questions tq ON tp.question_id = tq.id
         WHERE tq.category_id = ? AND tp.user_id != ?"
    );
    $stmt->execute([$catId, $excludeUserId]);
    $userIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if (!$userIds) return;
    $ins = $db->prepare("INSERT INTO tutorial_notifications (user_id, category_id, message) VALUES (?,?,?)");
    foreach ($userIds as $uid) {
        $ins->execute([(int)$uid, $catId, $message]);
    }
}

// ── LIST CATEGORIES ───────────────────────────────────────────────
if ($action === 'list_categories') {
    $cats = $db->query("SELECT * FROM tutorial_categories ORDER BY sort_order ASC, id ASC")->fetchAll();
    foreach ($cats as &$cat) {
        $s1 = $db->prepare("SELECT COUNT(*) FROM tutorial_questions WHERE category_id=? AND published=1");
        $s1->execute([$cat['id']]);
        $cat['question_count'] = (int)$s1->fetchColumn();

        if ($isPrivileged) {
            $s2 = $db->prepare("SELECT COUNT(*) FROM tutorial_questions WHERE category_id=?");
            $s2->execute([$cat['id']]);
            $cat['total_count'] = (int)$s2->fetchColumn();
        }

        $s3 = $db->prepare(
            "SELECT COUNT(*) FROM tutorial_progress tp
             JOIN tutorial_questions tq ON tp.question_id=tq.id
             WHERE tp.user_id=? AND tq.category_id=? AND tq.published=1"
        );
        $s3->execute([$me['id'], $cat['id']]);
        $cat['viewed_count'] = (int)$s3->fetchColumn();
        $cat['completed']    = $cat['question_count'] > 0 && $cat['viewed_count'] >= $cat['question_count'];
    }
    json_out(['categories' => $cats]);
}

// ── LIST QUESTIONS ────────────────────────────────────────────────
if ($action === 'list_questions') {
    $catId = (int)(post('category_id') ?? get('category_id'));
    if (!$catId) err('category_id required');

    $sql = $isPrivileged
        ? "SELECT * FROM tutorial_questions WHERE category_id=? ORDER BY sort_order ASC, id ASC"
        : "SELECT * FROM tutorial_questions WHERE category_id=? AND published=1 ORDER BY sort_order ASC, id ASC";
    $stmt = $db->prepare($sql);
    $stmt->execute([$catId]);
    $questions = $stmt->fetchAll();

    foreach ($questions as &$q) {
        $v = $db->prepare("SELECT 1 FROM tutorial_progress WHERE user_id=? AND question_id=?");
        $v->execute([$me['id'], $q['id']]);
        $q['viewed'] = (bool)$v->fetchColumn();
    }

    $cs = $db->prepare("SELECT * FROM tutorial_categories WHERE id=?");
    $cs->execute([$catId]);
    json_out(['questions' => $questions, 'category' => $cs->fetch()]);
}

// ── CREATE CATEGORY ───────────────────────────────────────────────
if ($action === 'create_category') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $name = trim(post('name') ?? '');
    $desc = trim(post('description') ?? '');
    $icon = trim(post('icon') ?? '📚');
    if (!$name) err('Name is required');
    $maxOrd = (int)$db->query("SELECT COALESCE(MAX(sort_order),0) FROM tutorial_categories")->fetchColumn();
    $db->prepare("INSERT INTO tutorial_categories (name,description,icon,sort_order) VALUES (?,?,?,?)")
       ->execute([$name, $desc, $icon, $maxOrd + 1]);
    json_out(['id' => (int)$db->lastInsertId(), 'ok' => true]);
}

// ── UPDATE CATEGORY ───────────────────────────────────────────────
if ($action === 'update_category') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $id   = (int)post('id');
    $name = trim(post('name') ?? '');
    $desc = trim(post('description') ?? '');
    $icon = trim(post('icon') ?? '📚');
    if (!$id || !$name) err('id and name required');
    $db->prepare("UPDATE tutorial_categories SET name=?,description=?,icon=? WHERE id=?")
       ->execute([$name, $desc, $icon, $id]);
    json_out(['ok' => true]);
}

// ── DELETE CATEGORY ───────────────────────────────────────────────
if ($action === 'delete_category') {
    if (!$isAdmin) err('Admin only', 403);
    $id = (int)post('id');
    if (!$id) err('id required');
    $db->prepare(
        "DELETE tp FROM tutorial_progress tp
         JOIN tutorial_questions tq ON tp.question_id=tq.id
         WHERE tq.category_id=?"
    )->execute([$id]);
    $db->prepare("DELETE FROM tutorial_notifications WHERE category_id=?")->execute([$id]);
    $db->prepare("DELETE FROM tutorial_questions WHERE category_id=?")->execute([$id]);
    $db->prepare("DELETE FROM tutorial_categories WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

// ── CREATE QUESTION ───────────────────────────────────────────────
if ($action === 'create_question') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $catId     = (int)post('category_id');
    $question  = trim(post('question') ?? '');
    $answer    = trim(post('answer')   ?? '');
    $published = (int)(post('published') ?? 0);
    if (!$catId || !$question || !$answer) err('category_id, question and answer are required');
    $mo = $db->prepare("SELECT COALESCE(MAX(sort_order),0) FROM tutorial_questions WHERE category_id=?");
    $mo->execute([$catId]);
    $order = (int)$mo->fetchColumn() + 1;
    $db->prepare("INSERT INTO tutorial_questions (category_id,question,answer,sort_order,published) VALUES (?,?,?,?,?)")
       ->execute([$catId, $question, $answer, $order, $published ? 1 : 0]);
    if ($published) {
        $cs = $db->prepare("SELECT name FROM tutorial_categories WHERE id=?");
        $cs->execute([$catId]);
        $catName = (string)$cs->fetchColumn();
        notifyStartedMembers($db, $catId, $me['id'], "New question added to \"$catName\"");
    }
    json_out(['id' => (int)$db->lastInsertId(), 'ok' => true]);
}

// ── UPDATE QUESTION ───────────────────────────────────────────────
if ($action === 'update_question') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $id        = (int)post('id');
    $question  = trim(post('question') ?? '');
    $answer    = trim(post('answer')   ?? '');
    $published = (int)(post('published') ?? 0);
    if (!$id || !$question || !$answer) err('id, question and answer are required');
    $db->prepare("UPDATE tutorial_questions SET question=?,answer=?,published=? WHERE id=?")
       ->execute([$question, $answer, $published ? 1 : 0, $id]);
    json_out(['ok' => true]);
}

// ── DELETE QUESTION ───────────────────────────────────────────────
if ($action === 'delete_question') {
    if (!$isAdmin) err('Admin only', 403);
    $id = (int)post('id');
    if (!$id) err('id required');
    $db->prepare("DELETE FROM tutorial_progress WHERE question_id=?")->execute([$id]);
    $db->prepare("DELETE FROM tutorial_questions WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

// ── TOGGLE PUBLISH ────────────────────────────────────────────────
if ($action === 'toggle_publish') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $id        = (int)post('id');
    $published = (int)(post('published') ?? 0);
    if (!$id) err('id required');
    // Read previous state so we only notify on 0→1 transition
    $prev = $db->prepare("SELECT published, category_id FROM tutorial_questions WHERE id=?");
    $prev->execute([$id]);
    $row = $prev->fetch();
    $db->prepare("UPDATE tutorial_questions SET published=? WHERE id=?")->execute([$published ? 1 : 0, $id]);
    if ($published && $row && !(int)$row['published']) {
        $catId = (int)$row['category_id'];
        $cs    = $db->prepare("SELECT name FROM tutorial_categories WHERE id=?");
        $cs->execute([$catId]);
        $catName = (string)$cs->fetchColumn();
        notifyStartedMembers($db, $catId, $me['id'], "New question published in \"$catName\"");
    }
    json_out(['ok' => true]);
}

// ── BULK CREATE QUESTIONS ─────────────────────────────────────────
if ($action === 'bulk_create') {
    if (!$isPrivileged) err('Unauthorized', 403);
    $catId     = (int)post('category_id');
    $pairs     = post('questions') ?? [];
    $published = (int)(post('published') ?? 0);
    if (!$catId) err('category_id required');
    if (!is_array($pairs) || !count($pairs)) err('questions array required');
    $mo = $db->prepare("SELECT COALESCE(MAX(sort_order),0) FROM tutorial_questions WHERE category_id=?");
    $mo->execute([$catId]);
    $order = (int)$mo->fetchColumn();
    $ins   = $db->prepare("INSERT INTO tutorial_questions (category_id,question,answer,sort_order,published) VALUES (?,?,?,?,?)");
    $saved = 0;
    foreach ($pairs as $p) {
        $q = trim($p['question'] ?? '');
        $a = trim($p['answer']   ?? '');
        if (!$q || !$a) continue;
        $order++;
        $ins->execute([$catId, $q, $a, $order, $published ? 1 : 0]);
        $saved++;
    }
    if ($published && $saved > 0) {
        $cs = $db->prepare("SELECT name FROM tutorial_categories WHERE id=?");
        $cs->execute([$catId]);
        $catName = (string)$cs->fetchColumn();
        $label   = $saved === 1 ? '1 new question' : "$saved new questions";
        notifyStartedMembers($db, $catId, $me['id'], "$label added to \"$catName\"");
    }
    json_out(['saved' => $saved, 'ok' => true]);
}

// ── MARK VIEWED ───────────────────────────────────────────────────
if ($action === 'mark_viewed') {
    $qid = (int)post('question_id');
    if (!$qid) err('question_id required');
    $db->prepare("INSERT IGNORE INTO tutorial_progress (user_id,question_id) VALUES (?,?)")
       ->execute([$me['id'], $qid]);
    json_out(['ok' => true]);
}

// ── GET NOTIFICATIONS ─────────────────────────────────────────────
if ($action === 'get_notifications') {
    $stmt = $db->prepare(
        "SELECT tn.*, tc.name AS category_name, tc.icon AS category_icon
         FROM tutorial_notifications tn
         JOIN tutorial_categories tc ON tn.category_id = tc.id
         WHERE tn.user_id = ?
         ORDER BY tn.created_at DESC
         LIMIT 30"
    );
    $stmt->execute([$me['id']]);
    $notifs = $stmt->fetchAll();
    $cs = $db->prepare("SELECT COUNT(*) FROM tutorial_notifications WHERE user_id=? AND is_read=0");
    $cs->execute([$me['id']]);
    json_out(['notifications' => $notifs, 'unread' => (int)$cs->fetchColumn()]);
}

// ── MARK NOTIFICATIONS READ ───────────────────────────────────────
if ($action === 'mark_read') {
    $db->prepare("UPDATE tutorial_notifications SET is_read=1 WHERE user_id=?")
       ->execute([$me['id']]);
    json_out(['ok' => true]);
}

err('Unknown action');
