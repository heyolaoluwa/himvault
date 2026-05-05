<?php
require_once __DIR__ . '/config.php';

$me     = requireAuth();
$action = post('action') ?? get('action');
$db     = getDB();

// ── LIST EXAMS ───────────────────────────────────────────────
if ($action === 'list') {
    // Admin sees all; students/tutors see only their cadre
    if ($me['role'] === 'admin') {
        $exams = $db->query('SELECT * FROM exams ORDER BY start_time ASC')->fetchAll();
    } else {
        $stmt = $db->prepare('SELECT * FROM exams WHERE cadre = ? ORDER BY start_time ASC');
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

    // Must be registered (admin bypass)
    if ($me['role'] !== 'admin') {
        $reg = $db->prepare('SELECT 1 FROM exam_registrations WHERE exam_id = ? AND user_id = ?');
        $reg->execute([$exam_id, $me['id']]);
        if (!$reg->fetchColumn()) err('You are not registered for this exam');
    }

    // Fetch questions (without correct answer — don't leak to client)
    $stmt = $db->prepare(
        'SELECT id, question_text, option_a, option_b, option_c, option_d
           FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC'
    );
    $stmt->execute([$exam_id]);
    $questions = $stmt->fetchAll();

    // Shuffle
    shuffle($questions);

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

    // Get correct answers
    $qstmt = $db->prepare('SELECT id, correct_option FROM exam_questions WHERE exam_id = ?');
    $qstmt->execute([$exam_id]);
    $correct_map = [];
    foreach ($qstmt->fetchAll() as $q) {
        $correct_map[$q['id']] = (int)$q['correct_option'];
    }

    // Score
    $score = 0;
    foreach ($correct_map as $qid => $correct) {
        if (isset($answers[$qid]) && (int)$answers[$qid] === $correct) {
            $score++;
        }
    }

    $attempt_id = genId();
    $db->prepare(
        'INSERT INTO exam_attempts (id, exam_id, user_id, score) VALUES (?, ?, ?, ?)'
    )->execute([$attempt_id, $exam_id, $me['id'], $score]);

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

    $db->prepare('UPDATE exams SET result_release_time = NOW() WHERE id = ?')->execute([$exam_id]);
    json_out(['ok' => true]);
}

// ── ADMIN RESULTS DETAIL ──────────────────────────────────────
if ($action === 'results') {
    requireRole($me, ['admin', 'tutor']);
    $exam_id = get('exam_id', '');
    if (!$exam_id) err('exam_id required');

    $attempts = $db->prepare(
        'SELECT a.id, a.user_id, a.score, a.submitted_at,
                u.name, u.matric_no, u.cadre,
                (SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?) AS total
           FROM exam_attempts a
           JOIN users u ON u.id = a.user_id
          WHERE a.exam_id = ?
          ORDER BY a.score DESC'
    );
    $attempts->execute([$exam_id, $exam_id]);
    json_out(['attempts' => $attempts->fetchAll()]);
}

err('Unknown action', 404);
