<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// Deterministic Fisher-Yates using a simple LCG — same seed = same shuffle every time
function seededShuffle(array $arr, int $seed): array {
    $n = count($arr);
    for ($i = $n - 1; $i > 0; $i--) {
        $seed = ($seed * 1664525 + 1013904223) & 0x7FFFFFFF;
        $j    = $seed % ($i + 1);
        [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
    }
    return $arr;
}

// ── LIST EXAMS ───────────────────────────────────────────────
if ($action === 'list') {
    // Ensure optional columns exist (one-time migrations, safe to repeat)
    try { $db->exec("ALTER TABLE exams ADD COLUMN status VARCHAR(32) NULL DEFAULT NULL"); }
    catch (PDOException $ignore) {}
    try { $db->exec("ALTER TABLE exams ADD COLUMN result_release_time DATETIME NULL DEFAULT NULL"); }
    catch (PDOException $ignore) {}
    try { $db->exec("ALTER TABLE exam_attempts ADD COLUMN flagged TINYINT(1) NOT NULL DEFAULT 0"); }
    catch (PDOException $ignore) {}
    try { $db->exec("ALTER TABLE exam_attempts ADD COLUMN flag_reason VARCHAR(255) NULL DEFAULT NULL"); }
    catch (PDOException $ignore) {}

    // Admin sees all; others see exams in their cadre OR exams with no cadre set
    if ($me['role'] === 'admin') {
        $exams = $db->query('SELECT * FROM exams ORDER BY start_time ASC')->fetchAll();
    } else {
        $stmt = $db->prepare(
            'SELECT * FROM exams
              WHERE cadre = ? OR cadre = \'\' OR cadre IS NULL OR cadre = \'All Cadres\'
              ORDER BY start_time ASC'
        );
        $stmt->execute([$me['cadre']]);
        $exams = $stmt->fetchAll();
    }

    foreach ($exams as &$exam) {
        // Count registered students
        $reg = $db->prepare('SELECT COUNT(*) FROM exam_registrations WHERE exam_id = ?');
        $reg->execute([$exam['id']]);
        $exam['registered_count'] = (int)$reg->fetchColumn();

        // Is current user registered?
        $isReg = $db->prepare('SELECT 1 FROM exam_registrations WHERE exam_id = ? AND user_id = ?');
        $isReg->execute([$exam['id'], $me['id']]);
        $exam['is_registered'] = (bool)$isReg->fetchColumn();

        // Has the current user submitted an attempt?
        $att = $db->prepare('SELECT score, submitted_at FROM exam_attempts WHERE exam_id = ? AND user_id = ?');
        $att->execute([$exam['id'], $me['id']]);
        $exam['my_attempt'] = $att->fetch() ?: null;

        // Question count
        $qc = $db->prepare('SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?');
        $qc->execute([$exam['id']]);
        $exam['question_count'] = (int)$qc->fetchColumn();
    }
    unset($exam);

    json_out(['exams' => $exams]);
}

// ── REGISTER FOR EXAM ────────────────────────────────────────
if ($action === 'register') {
    $exam_id = post('exam_id', '');
    if (!$exam_id) err('exam_id required');

    $exam = $db->prepare('SELECT * FROM exams WHERE id = ?');
    $exam->execute([$exam_id]);
    $e = $exam->fetch();
    if (!$e) err('Exam not found', 404);

    if (new DateTime() > new DateTime($e['registration_deadline']))
        err('Registration deadline has passed');

    $db->prepare(
        'INSERT IGNORE INTO exam_registrations (exam_id, user_id) VALUES (?, ?)'
    )->execute([$exam_id, $me['id']]);

    json_out(['ok' => true]);
}

// ── GET EXAM QUESTIONS (for student starting exam) ───────────
if ($action === 'start') {
    $exam_id = post('exam_id') ?? get('exam_id', '');
    if (!$exam_id) err('exam_id required');

    $exam = $db->prepare('SELECT * FROM exams WHERE id = ?');
    $exam->execute([$exam_id]);
    $e = $exam->fetch();
    if (!$e) err('Exam not found', 404);

    // Must be registered, and exam must be live (admin/tutor bypass)
    if ($me['role'] !== 'admin' && $me['role'] !== 'tutor') {
        $now       = new DateTime();
        $examStart = new DateTime($e['start_time']);
        $examEnd   = new DateTime($e['end_time']);
        $isTimeLive     = ($now >= $examStart && $now <= $examEnd);
        $isOverrideLive = ($e['status'] === 'live');
        if (!$isTimeLive && !$isOverrideLive) err('This exam is not currently active');

        $reg = $db->prepare('SELECT 1 FROM exam_registrations WHERE exam_id = ? AND user_id = ?');
        $reg->execute([$exam_id, $me['id']]);
        if (!$reg->fetchColumn()) err('You are not registered for this exam');
    }

    // Fetch questions (correct_option used server-side only for shuffle seeding)
    $stmt = $db->prepare(
        'SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option
           FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC'
    );
    $stmt->execute([$exam_id]);
    $questions = $stmt->fetchAll();

    // Seeded question-order shuffle: each student gets a unique but consistent ordering
    $qSeed    = abs(crc32($me['id'] . $exam_id));
    $questions = seededShuffle($questions, $qSeed);

    // Seeded option shuffle per question: options are also rearranged per student
    foreach ($questions as &$q) {
        $opts    = [$q['option_a'], $q['option_b'], $q['option_c'], $q['option_d']];
        $optIdx  = [0, 1, 2, 3];
        $shifted = seededShuffle($optIdx, abs(crc32($me['id'] . $q['id'])));
        $q['option_a'] = $opts[$shifted[0]];
        $q['option_b'] = $opts[$shifted[1]];
        $q['option_c'] = $opts[$shifted[2]];
        $q['option_d'] = $opts[$shifted[3]];
        unset($q['correct_option']); // never expose correct answer to client
    }
    unset($q);

    json_out(['exam' => $e, 'questions' => $questions]);
}

// ── SUBMIT EXAM ───────────────────────────────────────────────
if ($action === 'submit') {
    $exam_id = post('exam_id', '');
    $answers = post('answers', []);   // array: [question_id => selected_option (0-3)]

    if (!$exam_id) err('exam_id required');

    $exam = $db->prepare('SELECT * FROM exams WHERE id = ?');
    $exam->execute([$exam_id]);
    $e = $exam->fetch();
    if (!$e) err('Exam not found', 404);

    // Check not already submitted
    $prev = $db->prepare('SELECT id FROM exam_attempts WHERE exam_id = ? AND user_id = ?');
    $prev->execute([$exam_id, $me['id']]);
    if ($prev->fetch()) err('You have already submitted this exam');

    // Get correct answers and re-derive the same option shuffle used during the exam
    $qstmt = $db->prepare('SELECT id, correct_option FROM exam_questions WHERE exam_id = ?');
    $qstmt->execute([$exam_id]);
    $correct_map = [];
    foreach ($qstmt->fetchAll() as $q) {
        $optIdx  = [0, 1, 2, 3];
        $shifted = seededShuffle($optIdx, abs(crc32($me['id'] . $q['id'])));
        // shifted[newPos] = oldPos; find which new position the original correct option ended up at
        $newCorrect = array_search((int)$q['correct_option'], $shifted);
        $correct_map[$q['id']] = $newCorrect;
    }

    // Score
    $score = 0;
    foreach ($correct_map as $qid => $correct) {
        if (isset($answers[$qid]) && (int)$answers[$qid] === $correct) {
            $score++;
        }
    }

    $attempt_id  = genId();
    $flagged     = post('flagged',     false) ? 1 : 0;
    $flag_reason = post('flag_reason', null);
    $db->prepare(
        'INSERT INTO exam_attempts (id, exam_id, user_id, score, flagged, flag_reason) VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$attempt_id, $exam_id, $me['id'], $score, $flagged, $flag_reason]);

    // Save individual answers
    $ins = $db->prepare('INSERT INTO exam_attempt_answers (attempt_id, question_id, selected_option) VALUES (?, ?, ?)');
    foreach ($answers as $qid => $sel) {
        $ins->execute([$attempt_id, $qid, (int)$sel]);
    }

    json_out([
        'ok'           => true,
        'score'        => $score,
        'total'        => count($correct_map),
        'answered'     => count($answers),
    ]);
}

// ── CREATE EXAM (admin only) ──────────────────────────────────
if ($action === 'create') {
    requireRole($me, ['admin']);

    $title    = trim(post('title', ''));
    $cadre    = post('cadre', '');
    $start    = post('start_time', '');
    $end      = post('end_time', '');
    $reg_dl   = post('registration_deadline', '');
    $duration = (int)post('duration', 90);
    $questions = post('questions', []);  // array of {text, options:[...], correct:0-3}

    if (!$title || !$start) err('Title and start time are required');

    $exam_id = genId();
    $end     = $end ?: date('Y-m-d H:i:s', strtotime($start) + 3 * 3600);
    $reg_dl  = $reg_dl ?: $start;

    $db->prepare(
        'INSERT INTO exams (id, title, cadre, start_time, end_time, registration_deadline, duration_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([$exam_id, $title, $cadre, $start, $end, $reg_dl, $duration]);

    if (!empty($questions)) {
        $ins = $db->prepare(
            'INSERT INTO exam_questions (id, exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($questions as $i => $q) {
            $opts = array_pad((array)($q['options'] ?? []), 4, '');
            $ins->execute([genId(), $exam_id, $q['text'], $opts[0], $opts[1], $opts[2], $opts[3], (int)($q['correct'] ?? 0), $i]);
        }
    }

    json_out(['ok' => true, 'exam_id' => $exam_id]);
}

// ── RELEASE RESULTS (admin only) ─────────────────────────────
if ($action === 'release_results') {
    requireRole($me, ['admin']);
    $exam_id = post('exam_id', '');
    if (!$exam_id) err('exam_id required');

    // Ensure column exists before updating (handles fresh installs)
    try { $db->exec("ALTER TABLE exams ADD COLUMN result_release_time DATETIME NULL DEFAULT NULL"); }
    catch (PDOException $ignore) {}

    $db->prepare('UPDATE exams SET result_release_time = UTC_TIMESTAMP() WHERE id = ?')->execute([$exam_id]);
    json_out(['ok' => true]);
}

// ── ADMIN RESULTS DETAIL ──────────────────────────────────────
if ($action === 'results') {
    requireRole($me, ['admin', 'tutor']);
    $exam_id = get('exam_id', '');
    if (!$exam_id) err('exam_id required');

    // Get question count separately — avoids a PDO subquery parameter binding issue
    $qc = $db->prepare('SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?');
    $qc->execute([$exam_id]);
    $total = (int)$qc->fetchColumn();

    $stmt = $db->prepare(
        'SELECT a.id, a.user_id, a.score, a.submitted_at, a.flagged, a.flag_reason,
                u.name, u.matric_no, u.cadre
           FROM exam_attempts a
           JOIN users u ON u.id = a.user_id
          WHERE a.exam_id = ?
          ORDER BY a.score DESC'
    );
    $stmt->execute([$exam_id]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) { $r['total'] = $total; }
    unset($r);

    json_out(['attempts' => $rows]);
}

// ── SET EXAM STATUS OVERRIDE (admin only) ────────────────────
if ($action === 'set_status') {
    requireRole($me, ['admin']);
    $exam_id = post('exam_id', '');
    $status  = post('status', null); // null = auto (remove override)
    if (!$exam_id) err('exam_id required');

    $allowed = [null, 'registration_open', 'upcoming', 'live', 'ended'];
    if (!in_array($status, $allowed, true)) err('Invalid status value');

    $db->prepare('UPDATE exams SET status = ? WHERE id = ?')->execute([$status, $exam_id]);
    json_out(['ok' => true]);
}

// ── GET SINGLE EXAM (admin — for edit modal) ─────────────────
if ($action === 'get') {
    requireRole($me, ['admin']);
    $exam_id = get('exam_id', '');
    if (!$exam_id) err('exam_id required');

    $stmt = $db->prepare('SELECT * FROM exams WHERE id = ?');
    $stmt->execute([$exam_id]);
    $exam = $stmt->fetch();
    if (!$exam) err('Exam not found', 404);

    $qstmt = $db->prepare(
        'SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, sort_order
           FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC'
    );
    $qstmt->execute([$exam_id]);
    $exam['questions'] = $qstmt->fetchAll();

    json_out(['exam' => $exam]);
}

// ── UPDATE EXAM (admin only) ──────────────────────────────────
if ($action === 'update') {
    requireRole($me, ['admin']);
    $exam_id   = post('exam_id', '');
    $title     = trim(post('title', ''));
    $cadre     = post('cadre', '');
    $start     = post('start_time', '');
    $end       = post('end_time', '');
    $reg_dl    = post('registration_deadline', '');
    $duration  = (int)post('duration', 90);
    $questions = post('questions', null);

    if (!$exam_id || !$title || !$start) err('exam_id, title and start time are required');

    $db->prepare(
        'UPDATE exams SET title = ?, cadre = ?, start_time = ?, end_time = ?,
         registration_deadline = ?, duration_minutes = ? WHERE id = ?'
    )->execute([$title, $cadre, $start, $end ?: $start, $reg_dl ?: $start, $duration, $exam_id]);

    if ($questions !== null) {
        $db->prepare('DELETE FROM exam_questions WHERE exam_id = ?')->execute([$exam_id]);
        if (!empty($questions)) {
            $ins = $db->prepare(
                'INSERT INTO exam_questions (id, exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            foreach ($questions as $i => $q) {
                $opts = array_pad((array)($q['options'] ?? []), 4, '');
                $ins->execute([genId(), $exam_id, $q['text'], $opts[0], $opts[1], $opts[2], $opts[3], (int)($q['correct'] ?? 0), $i]);
            }
        }
    }

    json_out(['ok' => true]);
}

// ── REVIEW ANSWERS (student — after results released) ────────
if ($action === 'review') {
    $exam_id = get('exam_id', '');
    if (!$exam_id) err('exam_id required');

    $exam = $db->prepare('SELECT * FROM exams WHERE id = ?');
    $exam->execute([$exam_id]);
    $e = $exam->fetch();
    if (!$e) err('Exam not found', 404);
    if (!$e['result_release_time']) err('Results have not been released yet');

    // Get student's attempt
    $att = $db->prepare('SELECT id, score FROM exam_attempts WHERE exam_id = ? AND user_id = ?');
    $att->execute([$exam_id, $me['id']]);
    $attempt = $att->fetch();
    if (!$attempt) err('No attempt found for this exam');

    // Load individual answers the student submitted
    $ansStmt = $db->prepare('SELECT question_id, selected_option FROM exam_attempt_answers WHERE attempt_id = ?');
    $ansStmt->execute([$attempt['id']]);
    $studentAnswers = [];
    foreach ($ansStmt->fetchAll() as $a) {
        $studentAnswers[$a['question_id']] = (int)$a['selected_option'];
    }

    // Load questions
    $qstmt = $db->prepare(
        'SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, sort_order
           FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC'
    );
    $qstmt->execute([$exam_id]);
    $questions = $qstmt->fetchAll();

    // Re-apply same seeded question shuffle used during the exam
    $qSeed    = abs(crc32($me['id'] . $exam_id));
    $questions = seededShuffle($questions, $qSeed);

    // Re-apply same seeded option shuffle per question
    foreach ($questions as &$q) {
        $opts    = [$q['option_a'], $q['option_b'], $q['option_c'], $q['option_d']];
        $optIdx  = [0, 1, 2, 3];
        $shifted = seededShuffle($optIdx, abs(crc32($me['id'] . $q['id'])));

        $q['options']      = [$opts[$shifted[0]], $opts[$shifted[1]], $opts[$shifted[2]], $opts[$shifted[3]]];
        $q['correct_idx']  = (int)array_search((int)$q['correct_option'], $shifted);
        $q['selected_idx'] = array_key_exists($q['id'], $studentAnswers) ? $studentAnswers[$q['id']] : null;

        unset($q['option_a'], $q['option_b'], $q['option_c'], $q['option_d'], $q['correct_option'], $q['sort_order']);
    }
    unset($q);

    json_out(['questions' => $questions, 'score' => (int)$attempt['score'], 'total' => count($questions)]);
}

// ── DELETE EXAM (admin only) ──────────────────────────────────
if ($action === 'delete') {
    requireRole($me, ['admin']);
    $exam_id = post('exam_id', '');
    if (!$exam_id) err('exam_id required');

    // Collect attempt IDs first (avoids subquery in DELETE which can fail on some MySQL versions)
    $idsStmt = $db->prepare('SELECT id FROM exam_attempts WHERE exam_id = ?');
    $idsStmt->execute([$exam_id]);
    $attIds = $idsStmt->fetchAll(PDO::FETCH_COLUMN);

    if (!empty($attIds)) {
        $ph = implode(',', array_fill(0, count($attIds), '?'));
        try {
            $db->prepare("DELETE FROM exam_attempt_answers WHERE attempt_id IN ($ph)")
               ->execute($attIds);
        } catch (PDOException $ignore) {}   // table may not exist if no one has submitted yet
    }

    $db->prepare('DELETE FROM exam_attempts WHERE exam_id = ?')->execute([$exam_id]);
    $db->prepare('DELETE FROM exam_registrations WHERE exam_id = ?')->execute([$exam_id]);
    $db->prepare('DELETE FROM exam_questions WHERE exam_id = ?')->execute([$exam_id]);
    $db->prepare('DELETE FROM exams WHERE id = ?')->execute([$exam_id]);

    json_out(['ok' => true]);
}

// ── MY EXAM HISTORY (student — all their attempts) ───────────
if ($action === 'my_history') {
    $stmt = $db->prepare(
        'SELECT a.id, a.exam_id, a.score, a.submitted_at,
                e.title, e.cadre, e.result_release_time,
                (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) AS total
           FROM exam_attempts a
           JOIN exams e ON e.id = a.exam_id
          WHERE a.user_id = ?
          ORDER BY a.submitted_at ASC'
    );
    $stmt->execute([$me['id']]);
    json_out(['attempts' => $stmt->fetchAll()]);
}

err('Unknown action', 404);
