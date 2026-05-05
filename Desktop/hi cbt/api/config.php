<?php
// ── DATABASE CREDENTIALS ─────────────────────────────────────
// Fill these in from your TrueHost cPanel → MySQL Databases
define('DB_HOST', 'localhost');
define('DB_NAME', 'siuxgjee_himvault');    // e.g. user123_himvault
define('DB_USER', 'siuxgjee_himvault_admin');    // e.g. user123_himuser
define('DB_PASS', '?7Hl~}Var1fVGDe#');

// ── CORS (allow your domain to call the API) ─────────────────
$allowed_origin = 'www.himmedia.ng/himvault'; // change to your TrueHost domain
if (isset($_SERVER['HTTP_ORIGIN'])) {
    header('Access-Control-Allow-Origin: ' . $allowed_origin);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

header('Content-Type: application/json; charset=utf-8');

// ── SESSION ───────────────────────────────────────────────────
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params(['samesite' => 'Lax', 'httponly' => true, 'secure' => isset($_SERVER['HTTPS'])]);
    session_start();
}

// ── DATABASE CONNECTION (singleton PDO) ──────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

// ── HELPERS ───────────────────────────────────────────────────
function json_out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function err(string $msg, int $code = 400): void {
    json_out(['error' => $msg], $code);
}

function requireAuth(): array {
    if (empty($_SESSION['user_id'])) err('Not authenticated', 401);
    $db   = getDB();
    $stmt = $db->prepare('SELECT id, name, email, role, cadre, institution, bio, avatar_url, matric_no, joined_at FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user) { session_destroy(); err('Session expired', 401); }
    return $user;
}

function requireRole(array $user, array $roles): void {
    if (!in_array($user['role'], $roles, true)) err('Forbidden', 403);
}

function genId(): string {
    return bin2hex(random_bytes(4));
}

function post(string $key, $default = null) {
    $body = json_decode(file_get_contents('php://input'), true);
    if ($body && array_key_exists($key, $body)) return $body[$key];
    return $_POST[$key] ?? $default;
}

function get(string $key, $default = null) {
    return $_GET[$key] ?? $default;
}
