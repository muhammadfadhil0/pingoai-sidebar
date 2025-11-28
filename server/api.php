<?php
// api.php - Simple PHP Proxy for OpenAI API
// Upload this file to your PHP hosting

// CORS Headers - Allow access from your Electron app
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Configuration - HARDCODE YOUR API KEY HERE
// This file stays on your server, so it's safe!
$API_KEY = "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"; 
$API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Get JSON input
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);

if (!$input) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON input"]);
    exit();
}

// Validate required fields
if (!isset($input['messages']) || !isset($input['model'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing messages or model"]);
    exit();
}

// Prepare data for OpenAI
$data = [
    "model" => $input['model'],
    "messages" => $input['messages'],
    "max_tokens" => isset($input['max_tokens']) ? $input['max_tokens'] : 1000
];

// Initialize cURL
$ch = curl_init($API_URL);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_TIMEOUT, 60); // Timeout 60 detik
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // Disable SSL check temporarily for compatibility
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json",
    "Authorization: Bearer " . $API_KEY
]);

// Execute request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode(["error" => "Curl error: " . curl_error($ch)]);
} else {
    http_response_code($httpCode);
    echo $response;
}

curl_close($ch);
?>
